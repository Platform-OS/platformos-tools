import { LiquidTag, NodeTypes, Position, toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { Severity, SourceCodeType, LiquidCheckDefinition, LiquidHtmlFixer } from '../../types';
import { TagEntry } from '../../types/platformos-liquid-docs';
import { createBoundedCache } from '../../utils/bounded-cache';

/**
 * The successor THIS DOCSET STATES, which must also be a tag it knows and has not itself
 * deprecated — what keeps a stale or mistaken name from becoming a rename.
 *
 * The name is read as data and never out of `deprecation_reason`'s English. Upstream,
 * `deprecation_replacement` comes from the platform's documentation source
 * (`docs/generators/liquid_tags/default/module/setup.rb`), where an `@alias` publishes the
 * canonical name of the class it shares and a `@deprecated` tag with a class of its own
 * declares `@replaced_by`. `verify_tags_json.rb` fails the docs build if a deprecation names
 * no successor, or names one the platform does not register — so a docset that deprecates a
 * tag without naming its successor is a docs bug, and the right response here is no rename
 * rather than a guess parsed out of prose. check-node's `autofix.spec.ts` asserts the
 * committed docset still resolves every tag it deprecates, so a drift fails there by name.
 */
export function resolveReplacementTag(
  deprecatedTag: TagEntry,
  tags: TagEntry[],
): string | undefined {
  const replacement = deprecatedTag.deprecation_replacement?.trim();
  if (!replacement || replacement === deprecatedTag.name) return undefined;

  const known = tags.find((tag) => tag.name === replacement);
  return known && !known.deprecated ? replacement : undefined;
}

/**
 * The tag's markup exactly as written, read out of the SOURCE rather than off the markup
 * node: `markup` is a union of ~30 shapes, some without a position and some nullable, and
 * the parse we want to re-run is over text anyway.
 *
 * `blockStartPosition` is the opening tag in every form — `{%- hash_assign x -%}` written
 * inline, and the bare `hash_assign x` written inside a `{% liquid %}` block, which has no
 * delimiters at all — so taking everything after the name and dropping a trailing delimiter
 * covers both. The strip is anchored at the end because that is the only place the
 * delimiter that closes THIS tag can be, and `-` before it is whitespace control.
 *
 * It does not need to defend against a `%}` inside a quoted string: measured, the parser
 * ends the tag at the first `%}` whatever the quoting, so `{% assign x = '%}' %}` is already
 * a tag with raw-string markup plus a stray text node, and raw-string markup declines the
 * rename on its own.
 *
 * `split('').join('')` FLATTENS, and is not a no-op to be tidied away. V8 keeps a `slice`
 * result as a SlicedString referencing its parent — `replace`/`trim` preserve that, `concat`
 * and `normalize` do not flatten — so without this the few characters returned here retain the
 * whole file, and become a {@link probeCache} key that outlives the run. Measured with
 * `--expose-gc`: 33.5 MB retained across 256 keys, ~0 MB flattened. No test can see this.
 */
function markupSourceOf(node: LiquidTag, nameEnd: number): string {
  const openingEnd = node.blockStartPosition?.end ?? node.position.end;
  return node.source
    .slice(nameEnd, openingEnd)
    .replace(/-?%\}$/, '')
    .trim()
    .split('')
    .join('');
}

/**
 * Whether the replacement tag ACCEPTS this occurrence's markup — asked by handing the
 * renamed tag back to the parser, rather than by knowing anything about either tag.
 *
 * This is the whole safety argument, and it has to exist because "use {% x %} instead" is
 * advice about intent, not a promise that the markup carries over. It does for
 * `hash_assign h['k'] = 1` -> `assign`; it does not for
 * `execute_query 'q', result_name: 'g'` -> `graphql`, which wants
 * `graphql g = "path/to/query"` and would be rewritten into a tag the platform cannot parse.
 * Both answers fall out of this one call, and no tag is named to get them.
 *
 * The signal is this repo's existing invariant: a known tag whose strict markup rule does
 * not match keeps its markup as a raw STRING instead of throwing. So object markup after the
 * rename means the replacement's own grammar accepted it. Empty markup is accepted too —
 * `{% try_rc %}` -> `{% try %}` carries nothing that could be misread, and neither tag has a
 * markup rule to satisfy.
 *
 * Reconstructed as a standalone tag rather than sliced out of the document, so the same
 * question can be asked about a tag written inside a `{% liquid %}` block, where it has no
 * delimiters of its own.
 *
 * BLOCK-NESS IS CHECKED STRUCTURALLY, not left to the parse failing. A block tag is probed
 * with its `end`, but measured, `{% assign x %}{% endassign %}` does NOT throw — it yields a
 * non-block `assign` and a SEPARATE `endassign` tag, so a dangling end is not self-refuting.
 * Comparing what the replacement became against what the original was is what declines
 * `{% parse_json car %}…{% endparse_json %}` -> `assign`: that migration moves the body into
 * the markup (`{% assign car = { … } %}`), which is a rewrite, not a rename, and half of it
 * would silently delete the author's JSON.
 *
 * Empty markup still goes through the probe for exactly that reason: `{% parse_json %}` with
 * no variable has empty markup too, and short-circuiting on that alone accepts it.
 */
function replacementAcceptsMarkup(node: LiquidTag, replacement: string, nameEnd: number): boolean {
  const markup = markupSourceOf(node, nameEnd);
  const isBlock = Boolean(node.blockEndPosition);

  return probeCache(`${replacement}\0${isBlock}\0${markup}`, () =>
    probeReplacement(replacement, markup, isBlock),
  );
}

/**
 * Answers to {@link replacementAcceptsMarkup}, one parse each, asked once per deprecated-tag
 * OCCURRENCE. Sized by measurement on the four `~/projects/pos` baseline projects: 5162
 * occurrences, 2049 distinct probes, 2494 ms -> 969 ms fully cached, and an LRU of 256 answers
 * 39-52% (128 and 1024 are within a few points, so the working set is local). The memo outlives
 * a lint run, so a repeated `lintBuffer` over an unchanged buffer re-probes nothing.
 *
 * The key holds the markup TEXT because that is what the answer depends on. A hash would be
 * constant-size and a collision would rename a tag into one the platform cannot parse, in an
 * autofix that writes to disk unattended — so the bytes are the cheaper side of that trade,
 * and there are few of them because {@link markupSourceOf} flattens what it returns.
 */
const probeCache = createBoundedCache<boolean>(256);

function probeReplacement(replacement: string, markup: string, isBlock: boolean): boolean {
  const opening = markup === '' ? `{% ${replacement} %}` : `{% ${replacement} ${markup} %}`;
  const probe = isBlock ? `${opening}{% end${replacement} %}` : opening;

  let renamed: LiquidTag | undefined;
  try {
    // The probe is one reconstructed tag, so the tag is a top-level child by construction.
    renamed = toLiquidHtmlAST(probe).children.find(
      (child): child is LiquidTag =>
        child.type === NodeTypes.LiquidTag && child.name === replacement,
    );
  } catch {
    // The parser is tolerant but not total; either way it did not accept this.
    return false;
  }
  if (!renamed) return false;

  // A block tag may only become a block tag, and an inline one an inline one.
  if (Boolean(renamed.blockEndPosition) !== isBlock) return false;

  // Nothing to carry over means nothing to misread — `{% try_rc %}` -> `{% try %}`, where
  // neither tag has a markup rule to satisfy.
  return markup === '' || typeof renamed.markup !== 'string';
}

/** A span of the source and what goes there instead. */
interface Replacement extends Position {
  text: string;
}

/** Where the tag's own name sits in the source, for a tag written either way. */
function tagNameRange(node: LiquidTag): Position {
  const start = node.source.indexOf(node.name, node.position.start);
  return { start, end: start + node.name.length };
}

/**
 * Every span that has to change to rename this tag: its own name, plus a block tag's
 * closing `end<name>`. Renaming only half of a block would leave the document unparseable.
 */
function renamesFor(
  node: LiquidTag,
  nameRange: Position,
  replacement: string,
): Replacement[] | undefined {
  const renames: Replacement[] = [{ ...nameRange, text: replacement }];

  const blockEnd = node.blockEndPosition;
  if (!blockEnd) return renames;

  const closingName = `end${node.name}`;
  const offset = node.source.slice(blockEnd.start, blockEnd.end).indexOf(closingName);
  // Defensive rather than reachable: `blockEndPosition` is recorded from the very
  // `end<name>` token the parser matched, and an unclosed block throws during parse, so
  // that file's `ast` is an Error and no check ever visits it (`src/index.ts`).
  if (offset === -1) return undefined;

  const start = blockEnd.start + offset;
  renames.push({ start, end: start + closingName.length, text: `end${replacement}` });
  return renames;
}

/**
 * Only the NAMES are replaced, so markup, delimiters and whitespace control all survive
 * verbatim — and the same spans work inside a `{% liquid %}` block, where a tag has no
 * delimiters of its own but still carries document-absolute positions.
 */
function renameFix(
  node: LiquidTag,
  deprecatedTag: TagEntry,
  tags: TagEntry[],
  nameRange: Position,
): LiquidHtmlFixer | undefined {
  const replacement = resolveReplacementTag(deprecatedTag, tags);
  if (!replacement || !replacementAcceptsMarkup(node, replacement, nameRange.end)) return undefined;

  const renames = renamesFor(node, nameRange, replacement);
  if (!renames) return undefined;

  return (corrector) => {
    for (const { start, end, text } of renames) corrector.replace(start, end, text);
  };
}

export const DeprecatedTag: LiquidCheckDefinition = {
  meta: {
    code: 'DeprecatedTag',
    aliases: ['DeprecatedTags'],
    name: 'Deprecated Tag',
    docs: {
      description: 'This check is aimed at eliminating the use of deprecated tags.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-tag',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    if (!context.platformosDocset) {
      return {};
    }

    return {
      async LiquidTag(node) {
        const tags = await context.platformosDocset!.tags();

        const deprecatedTag = tags.find((t) => t.deprecated && t.name === node.name);

        if (!deprecatedTag) {
          return;
        }

        const nameRange = tagNameRange(node);

        const message = deprecatedTag.deprecation_reason
          ? `Deprecated tag '${node.name}': ${deprecatedTag.deprecation_reason}`
          : `Deprecated tag '${node.name}'.`;

        context.report({
          message,
          startIndex: nameRange.start,
          endIndex: nameRange.end,
          fix: renameFix(node, deprecatedTag, tags, nameRange),
        });
      },
    };
  },
};
