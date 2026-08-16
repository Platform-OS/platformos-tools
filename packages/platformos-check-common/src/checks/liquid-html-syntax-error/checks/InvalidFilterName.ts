import {
  LiquidVariableOutput,
  LiquidTag,
  LiquidHtmlNode,
  NodeTypes,
  NamedTags,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType, Context, FilterEntry } from '../../..';
import { filterArities, resolveArity } from '../../../filter-arity-lookup';
// Directly, NOT through the package index: `visit` is a runtime value and the index imports
// `checks/index.ts`, which imports this file. The type-only imports above are erased and so cannot
// form a cycle; this one can, and did — every check in the package failed to initialise
// ("Cannot read properties of undefined (reading 'meta')") until the path was shortened.
import { visit } from '../../../visitor';
import { INVALID_SYNTAX_MESSAGE } from './utils';

/**
 * Whether replacing `[start, end)` of the file with `replacement` leaves THIS tag's markup
 * parseable — i.e. whether the proposed repair repairs anything.
 *
 * The tag is located by its own start offset, which the replacement cannot move: every repair here
 * begins after the filter name, so it is strictly inside the tag. String markup is the parser's
 * way of saying it rejected the tag (see the note on tolerance in the parser package), so
 * non-string markup is the whole test.
 */
async function markupParsesAfterRepair(
  node: LiquidVariableOutput | LiquidTag,
  start: number,
  end: number,
  replacement: string,
): Promise<boolean> {
  const candidate = node.source.slice(0, start) + replacement + node.source.slice(end);

  let ast: LiquidHtmlNode;
  try {
    ast = toLiquidHtmlAST(candidate);
  } catch {
    // The parser is tolerant and rarely throws, but stage 2 does on a shape it cannot model.
    // Either way, this is not a repair.
    return false;
  }

  const startsHere = async (candidateNode: LiquidVariableOutput | LiquidTag) =>
    candidateNode.position.start === node.position.start
      ? typeof candidateNode.markup !== 'string'
      : undefined;

  const verdicts = await visit<SourceCodeType.LiquidHtml, boolean>(ast, {
    LiquidVariableOutput: startsHere,
    LiquidTag: startsHere,
  });

  return verdicts[0] === true;
}

export async function detectInvalidFilterName(
  node: LiquidVariableOutput | LiquidTag,
  filters: FilterEntry[] | undefined,
): Promise<Problem<SourceCodeType.LiquidHtml>[]> {
  if (!filters) {
    return [];
  }

  if (node.type === NodeTypes.LiquidVariableOutput) {
    if (typeof node.markup !== 'string') {
      return [];
    }
    return detectInvalidFilterNameInMarkup(node, node.markup, filters);
  }

  if (node.type === NodeTypes.LiquidTag) {
    if (node.name === NamedTags.echo && typeof node.markup !== 'string') {
      return [];
    }
    if (node.name === NamedTags.assign && typeof node.markup !== 'string') {
      return [];
    }
    if (
      typeof node.markup === 'string' &&
      (node.name === NamedTags.echo || node.name === NamedTags.assign)
    ) {
      return detectInvalidFilterNameInMarkup(node, node.markup, filters);
    }
  }

  return [];
}

async function detectInvalidFilterNameInMarkup(
  node: LiquidVariableOutput | LiquidTag,
  markup: string,
  filters: FilterEntry[],
): Promise<Problem<SourceCodeType.LiquidHtml>[]> {
  const knownFilters = filters;
  const trimmedMarkup = markup.trim();
  const problems: Problem<SourceCodeType.LiquidHtml>[] = [];

  const filterPattern = /\|\s*([a-zA-Z][a-zA-Z0-9_]*)/g;
  const matches = Array.from(trimmedMarkup.matchAll(filterPattern));

  for (const match of matches) {
    const filterName = match[1];

    if (!knownFilters.some((filter) => filter.name === filterName)) {
      continue;
    }

    const filterEndIndex = match.index! + match[0].length;
    const afterFilter = trimmedMarkup.slice(filterEndIndex);

    // This regex finds invalid trailing characters after a filter name using lookaheads:
    // 1. Skip valid syntax like ": parameter" or "| nextfilter"
    // 2. Capture any junk characters that shouldn't be there
    // 3. Stop before valid boundaries like colons or pipes
    // e.g. "upcase xyz" finds "xyz", but "upcase | downcase" is ignored as valid
    const invalidSegment = afterFilter.match(
      /^(?!\s*(?::|$|\|\s*[a-zA-Z]|\|\s*\||\s*\|\s*(?:[}%]|$)))([^:|]+?)(?=\s*(?::|$|\|))/,
    )?.[1];
    if (!invalidSegment) {
      continue;
    }

    const markupStartInSource = node.source.indexOf(markup, node.position.start);
    const trailingStartInSource = markupStartInSource + filterEndIndex;
    const trailingEndInSource = trailingStartInSource + invalidSegment.length;

    /**
     * A trailing segment that begins with a COMMA is the filter's ARGUMENTS written with the
     * wrong separator. The canonical spelling is `| filter: arg1, arg2`, so this is always
     * reported; what took work is choosing the repair.
     *
     * MEASURED: a comma NEVER introduces a filter. Against a filter that takes NO argument, where
     * chaining would be valid, the two readings disagree — `{{ 'HELLO' | downcase | size }}`
     * renders 5, while `{{ 'HELLO' | downcase, size }}` raises "wrong number of arguments (given
     * 2, expected 1)". Confirmed positively too: `{{ 'HELLO' | append, size }}` renders `HELLOZ`,
     * identical to `| append: size`.
     *
     * So the runtime always reads what follows as an argument, and the author's INTENT is what
     * differs between cases:
     *
     *   `{{ 'HELLO' | append, ' world' }}`   meant `| append: ' world'`
     *   `{{ 'HELLO' | upcase, downcase }}`   meant `| upcase | downcase`
     *
     * ARITY TELLS THEM APART, using the same contract `FilterArity` blocks on: read as an
     * argument the first gives `append` 2 and its arity is exactly 2, so it fits; the second
     * gives `upcase` 2 against an arity of 1, so the argument reading is impossible. That is a
     * fact about the filters, not a guess about the author.
     *
     * Deleting the segment is wrong in every case: it drops arguments the runtime applies,
     * turning `111.00` into `111.000` for `| format_number, precision: 2`.
     */
    const argumentSeparator = invalidSegment.match(/^(\s*),/);

    if (argumentSeparator) {
      const afterComma = invalidSegment.slice(argumentSeparator[0].length);
      const described = afterComma.trim();
      const arity = resolveArity(filterName, filterArities(filters));

      /**
       * A bare identifier is the only shape that could have been meant as a FILTER rather than an
       * argument — `', 1, 2'` and `", ' suffix'"` can only be arguments. It is also exactly ONE
       * argument, so the argument reading hands the filter 2, which is why the count below is a
       * literal 2 rather than a parse of the segment.
       *
       * THREE FACTS ARE NEEDED, not one:
       *
       *   1. it names a filter that EXISTS. `', Downcase'` has the shape of a filter name and is
       *      not one, so chaining it invents a filter nobody wrote and deletes an argument.
       *   2. the filter CANNOT TAKE the argument, so the argument reading is impossible rather
       *      than merely wrong. That is `max < 2` on a BOUNDED max — not "2 is outside the
       *      range", which is also true when the range starts ABOVE 2, as it does for the nine
       *      shipped filters with `min >= 3`.
       *   3. an unknown arity is not fact 2, and no longer has to be: falling through to the
       *      separator repair is behaviour-preserving, because the comma and colon forms are the
       *      same call.
       *
       * Where any of the three is missing, the separator repair applies and the end state is
       * either correct or REPORTED — `| upcase: Downcase` parses, and `FilterArity` then counts
       * it. Counting arguments here as well would be a second, weaker arity implementation
       * reading raw source.
       */
      const looksLikeFilterName = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(described);
      const isKnownFilter = knownFilters.some((filter) => filter.name === described);
      const cannotTakeArgument = !!arity && arity.max !== null && arity.max < 2;

      if (described === '') {
        // Nothing follows the comma, so there is no argument and no filter — just a stray comma.
        // Rewriting it to `:` produced `| append: `, which is a syntax error at render AND reports
        // nothing on a re-lint: a file that looks clean and 500s.
        problems.push({
          message: `${INVALID_SYNTAX_MESSAGE} Filter '${filterName}' has a trailing ',' with nothing after it.`,
          startIndex: trailingStartInSource,
          endIndex: trailingEndInSource,
          fix: (corrector) => {
            corrector.replace(trailingStartInSource, trailingEndInSource, '');
          },
        });
        continue;
      }

      if (looksLikeFilterName && isKnownFilter && cannotTakeArgument) {
        problems.push({
          message:
            `${INVALID_SYNTAX_MESSAGE} Filter '${filterName}' is followed by ', ${described}', but a ',' after a ` +
            `filter name passes an argument — and '${filterName}' does not accept one, so this raises at render. ` +
            `Chain '${described}' with '|' instead.`,
          startIndex: trailingStartInSource,
          endIndex: trailingEndInSource,
          fix: (corrector) => {
            corrector.replace(trailingStartInSource, trailingEndInSource, ` | ${described}`);
          },
        });
        continue;
      }

      /**
       * THE REPAIR IS ONLY OFFERED IF IT PARSES, measured against the parser rather than reasoned
       * about, because the shapes that fail do not look like they would:
       * `{{ 'HELLO' | append, 'a' 'b' }}` became `| append: 'a' 'b'`, which still has string
       * markup — so nothing parsed it, no check reported it, and the author was left with a file
       * the linter called clean and the runtime answered with a 500.
       *
       * Validated with the real parser, not a hand-rolled argument-list matcher: a second, weaker
       * grammar reading raw source is what this check keeps being bitten by. When the repair does
       * not parse the offense still reports, without an autofix.
       */
      const separatorRepair = `${argumentSeparator[1]}:${afterComma}`;
      const problem: Problem<SourceCodeType.LiquidHtml> = {
        message:
          `${INVALID_SYNTAX_MESSAGE} Filter '${filterName}' separates its arguments with ',' instead of ':'. ` +
          `Use ':' after the filter name and ',' only between arguments.`,
        startIndex: trailingStartInSource,
        endIndex: trailingEndInSource,
      };

      if (
        await markupParsesAfterRepair(
          node,
          trailingStartInSource,
          trailingEndInSource,
          separatorRepair,
        )
      ) {
        problem.fix = (corrector) => {
          corrector.replace(trailingStartInSource, trailingEndInSource, separatorRepair);
        };
      }

      problems.push(problem);
      continue;
    }

    problems.push({
      message: `${INVALID_SYNTAX_MESSAGE} Filter '${filterName}' has trailing characters '${invalidSegment}' that should be removed.`,
      startIndex: trailingStartInSource,
      endIndex: trailingEndInSource,
      fix: (corrector) => {
        corrector.replace(trailingStartInSource, trailingEndInSource, '');
      },
    });
  }

  return problems;
}
