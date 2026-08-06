import { LiquidTag, LiquidTagLiquid, NamedTags } from '@platformos/liquid-html-parser';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * A `{% liquid %}` block that ended at a `%}` the author did not write as its terminator.
 *
 * THE DEFECT. The `{% liquid %}` lexer scans for the closing `%}` with no awareness of
 * comments or quoting, so the FIRST `%}` anywhere inside the block ends it. The remaining
 * statements are then re-read as template TEXT and rendered into the response body. Nothing
 * raises: the page returns 200 and `liquid_exec` answers `ok: true, error: null`.
 *
 * MEASURED against `/api/app_builder/liquid_exec`:
 *
 *   {% liquid                                     {% liquid
 *     # a comment mentioning %} the rest            assign s = "a %} b"
 *     assign d = 21 | times: 2                      assign d = 21 | times: 2
 *   %}R=[{{ d }}]                                 %}R=[{{ d }}]
 *
 *   -> " the rest\n  assign d = …\n%}R=[]"        -> " b\"\n  assign d = …\n%}R=[]"
 *
 * Both render the block's own source to the client and leave `d` unset. A control with no
 * `%}` inside the block renders `R=[42]`.
 *
 * IT IS NOT A COMMENT RULE, which is the intuitive reading and the wrong one. The string case
 * above involves no comment at all, and a rule written as "a `#` comment containing `%}`"
 * misses it. `{% comment %}…{% endcomment %}` OUTSIDE a liquid block is unaffected — measured,
 * it renders correctly — so this is specific to the `{% liquid %}` line lexer.
 *
 * WHY A CHECK AND NOT A GRAMMAR FIX. `toLiquidHtmlAST` truncates at exactly the same offset the
 * platform does. There is no divergence to correct: the AST is a faithful record of what will
 * happen. Teaching our parser to be smarter than the platform would make it ACCEPT a block the
 * platform mangles, turning a visible defect into a false approval. The parser bug belongs
 * upstream; this check is the mitigation.
 *
 * WHY NOT `InvalidTagSyntax`, which owns "known tag whose markup will not parse". It does not
 * fire inside a `{% liquid %}` block today, and making it do so would produce the wrong
 * diagnosis: `assign s = "a %} b"` is perfectly valid Liquid, and telling the author their
 * `assign` syntax is broken sends them to the one line that is correct. Naming the wrong
 * construct is this defect's main cost — the runtime already does it, raising "function must
 * return a value" against a `return` that is present — so a check that repeats the mistake is
 * worth less than nothing.
 *
 * NO AUTOFIX, and the reason is not that a correct output is unknown. Both repairs are
 * MEASURED to work:
 *
 *   a string:   assign s = "a %" | append: "} b"          renders `a %} b`
 *   a comment:  {% comment %} … %} … {% endcomment %}     renders, outside the block
 *
 * What is missing is a trustworthy INPUT. The parser stopped at the delimiter, so the author's
 * intended block exists only as raw text on the far side of the truncation — the statements
 * after it were re-read as template content and the string that caused it was never parsed
 * into a node. Rewriting from that means re-lexing the region by hand, which is re-implementing
 * the very lexer whose blind spot created the defect. An autofix is applied without review, and
 * the printer regenerates source from the AST, so a misread there silently rewrites a whole
 * block. The measured recipes go in the MESSAGE instead, where the author applies them with
 * the intent that only they have.
 *
 * Worth knowing for anyone who revisits this: a literal `%}` cannot appear in ANY Liquid string.
 * A standalone `{% assign s = "a %} b" %}` truncates the same way, and `{{ "a %} b" }}` raises
 * `Variable '{{ "a %}' was not properly terminated`. Composition is the only spelling there is.
 */
export const TruncatedLiquidBlock: LiquidCheckDefinition = {
  meta: {
    code: 'TruncatedLiquidBlock',
    name: 'Truncated {% liquid %} block',
    docs: {
      description:
        'Reports a {% liquid %} block whose closing %} was consumed by a comment or a string literal inside it. The block ends early, its remaining statements are rendered to the page as text, and nothing raises at runtime.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidTag(node: LiquidTag) {
        if (!isLiquidTagLiquid(node)) return;
        if (!swallowedItsOwnDelimiter(node)) return;
        if (!hasStrandedDelimiter(node)) return;

        context.report({
          message:
            'This {% liquid %} block ends EARLY, at a %} inside one of its own statements — a ' +
            'comment or a string — so the statements after that point never run and are ' +
            'rendered to the page as text. Nothing raises: the platform ends the block at the ' +
            'first %} it finds, wherever it appears. To keep the sequence in a string, build ' +
            'it — assign s = "a %" | append: "} b". To keep it in a comment, move the comment ' +
            'out of the block into {% comment %}...{% endcomment %}, which is unaffected.',
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};

/**
 * A `{% liquid %}` tag whose statements the parser read as a list.
 *
 * The array check is not redundant with the name check. The parser is TOLERANT: when a known
 * tag's markup does not match its rule the markup survives as a raw STRING rather than
 * throwing, so `node.markup` is not `LiquidStatement[]` by virtue of the name alone.
 */
function isLiquidTagLiquid(node: LiquidTag): node is LiquidTagLiquid {
  return node.name === NamedTags.liquid && Array.isArray(node.markup);
}

/**
 * Did the block's closing delimiter get consumed by the LAST statement's own line?
 *
 * POSITIONS, NOT A HAND-ROLLED LEXER. The discriminator is whether the closing `%}` shares a
 * line with the last statement, which the parser has already told us: compare the statement's
 * start offset against the offset just past the final newline inside the tag. Re-lexing the
 * last line instead would have to decide whether a `#` is a comment or lives inside a string —
 * `{% liquid assign a = "a # b" %}` is valid and must stay silent — and that is precisely the
 * mistake the platform makes. Asking the AST costs nothing and cannot make it.
 *
 *   {% liquid              {% liquid                {% liquid
 *     assign x = 1           assign x = 1             # trailing %}
 *     # done                 assign s = "a %}       ^ statement and %} share a line -> swallowed
 *   %}                     ^ share a line -> swallowed
 *   ^ %} on its own line, statement above -> fine
 *
 * A one-liner (`{% liquid assign a = 1 %}`) has no newline, so the statement and the delimiter
 * share the only line there is. That is why the KIND of statement is required too — a parsed
 * `assign` never swallowed anything, and the one-liner is the commonest valid block there is.
 */
function swallowedItsOwnDelimiter(node: LiquidTagLiquid): boolean {
  const statements = node.markup;
  const last = statements[statements.length - 1];
  if (!last) return false;

  const span = node.source.slice(node.position.start, node.position.end);
  const lastNewline = span.lastIndexOf('\n');
  // No newline at all means the whole tag is one line, so every statement is on the closing
  // delimiter's line. The statement KIND below is what decides it in that case.
  const finalLineStart = node.position.start + lastNewline + 1;
  if (last.position.start < finalLineStart) return false;

  // A `#` comment runs to end of line, so a delimiter on its line was inside the comment.
  if (last.name === '#') return true;

  // Otherwise: a statement the parser could not read. A truncated statement keeps whatever text
  // preceded the delimiter (`s = "a`), which is why its markup falls back to a raw string.
  // `break` and `continue` legitimately carry empty markup and must not be mistaken for it.
  return typeof last.markup === 'string' && last.markup.trim() !== '';
}

/**
 * Is the author's REAL closing delimiter now loose in the template text?
 *
 * The second half of the conjunction, and it is what separates a truncation from a construct
 * that merely looks like one. `{% liquid # a note %}` swallows its delimiter by the rule above
 * yet loses nothing — the block held one comment and the author wrote no more. A genuine
 * truncation always strands the `%}` that was meant to close the block, because a block the
 * author actually closed has one.
 *
 * The scan skips whole Liquid constructs so that a delimiter belonging to something else is
 * never counted: `{{ '%}' }}` is a string in an output, and `{% raw %}…%}…{% endraw %}` is raw
 * body text. Both were false positives for an earlier version that scanned the raw source
 * blindly, and both are silent now.
 */
function hasStrandedDelimiter(node: LiquidTagLiquid): boolean {
  const source = node.source;
  let index = node.position.end;

  while (index < source.length) {
    const pair = source.slice(index, index + 2);

    if (pair === '{%' || pair === '{{') {
      const closer = pair === '{%' ? '%}' : '}}';
      const end = source.indexOf(closer, index + 2);
      // An unterminated construct is a different defect, and not one this check should guess at.
      if (end === -1) return false;
      index = end + closer.length;
      continue;
    }

    if (pair === '%}') return true;
    index++;
  }

  return false;
}
