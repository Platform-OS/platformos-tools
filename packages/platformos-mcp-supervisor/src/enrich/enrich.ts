/**
 * The PURE enrichment stage: what the supervisor adds to a diagnostic beyond what the
 * engine reported.
 *
 * It adds exactly two things, and **authors neither of them**:
 *
 *   `see_also`  the check's own documentation page, from check-common `meta.docs.url`.
 *   `hint`      the docset entry for the symbol the diagnostic is about, rendered by the
 *               same function every editor hover uses.
 *
 * The restraint is the design. The supervisor ships no documentation (ARCHITECTURE.md
 * §Invariants #6): the words an agent reads come from `filters.json` / `tags.json` /
 * `objects.json` and from the check registry, both owned and tested where they are
 * published. A hint composed here would be a second source of truth that goes stale.
 *
 * PURE, and mechanically so: no `fs`, no `process`, no import of `lint/`, nothing async.
 * The docset arrives already resolved to plain arrays, so "no I/O below the lint edge" is a
 * matter of shape rather than of trust.
 */
import type {
  FilterEntry,
  LiquidHtmlNode,
  ObjectEntry,
  TagEntry,
} from '@platformos/platformos-check-common';
// Deep import, NOT the package root: measured at +5 ms against +110 ms, the difference
// being the css / json / graphql language services this package never uses. The bin is
// launched once per agent session, so that is paid every session. See ADR 002 Amendment 1.
import { render } from '@platformos/platformos-language-server-common/dist/docset/index.js';

import { checkDocs } from '../check-docs.js';
import type { ValidateCodeDiagnostic } from '../result/types.js';
import { documentedSymbolAt, type DocumentedSymbol } from './symbol.js';

/**
 * The docset, resolved to data.
 *
 * Plain arrays rather than the `AugmentedPlatformOSDocset` itself, whose methods return
 * promises and would let a future edit `await` inside the pure stage. The caller resolves it
 * once per request and hands over the result.
 */
export interface DocsetVocabulary {
  filters: readonly FilterEntry[];
  tags: readonly TagEntry[];
  objects: readonly ObjectEntry[];
}

/**
 * The checks for which a published SIGNATURE is the answer.
 *
 * Policy, not documentation — a statement about which findings an agent can act on with a
 * signature in front of it, the same kind of judgement as `BLOCKING_CHECKS`. Each entry
 * says why, because "it seemed relevant" is how this grows into noise.
 *
 * DEFAULTS TO SILENCE. A check not listed gets no hint, so a check added upstream cannot
 * start emitting an unrelated wall of markdown before anyone has looked at it.
 *
 * A list rather than a structural rule, because no structural rule separates the useful
 * case from the useless one: `{% render 'ghost' %}` resolves to the `render` TAG, so
 * rendering whatever symbol an offense sits on answers "'ghost' does not exist" with
 * general documentation about how `render` works.
 */
export const SIGNATURE_HINT_CHECKS: ReadonlySet<string> = new Set([
  // "given 1, expected 2" — the published arity IS the fix, and it is the one thing the
  // message cannot carry without restating the documentation.
  'FilterArity',
  // An argument of the wrong type. What the filter actually accepts is the answer, and
  // the parameter list is where it is written down.
  'ValidFilterArgumentTypes',
  // The same for a tag's arguments: `{% for x in y limit: 'ten' %}` is answered by the
  // `for` entry's parameter types.
  'ValidTagArgumentTypes',
]);

/** One diagnostic, with the buffer offset the engine reported it at. */
export interface EnrichInput {
  diagnostic: ValidateCodeDiagnostic;
  /**
   * 0-based offset of the offense start, in the buffer as sent. Carried alongside rather
   * than added to `ValidateCodeDiagnostic`, which an agent reads.
   *
   * OPTIONAL, and absence means "do not resolve a symbol for this one" — not spelled as an
   * out-of-range sentinel, which only LOOKS inert: `findCurrentNode` always answers, and at
   * an impossible offset it answers `Document`.
   */
  startIndex?: number;
}

/** Everything enrichment reads. All of it data; none of it fetched here. */
export interface EnrichContext {
  /**
   * The buffer's Liquid tree, as returned by the lint that produced these diagnostics.
   *
   * `undefined` for a buffer with no Liquid tree — GraphQL, YAML, or a file that did not
   * parse. Those diagnostics simply get no symbol hint; the check's documentation URL
   * still attaches, because it does not depend on the tree.
   */
  ast?: LiquidHtmlNode;
  vocabulary: DocsetVocabulary;
}

/**
 * Attach what we can to each diagnostic, and nothing we cannot.
 *
 * Returns NEW objects; the inputs are not mutated. A diagnostic gains a key only when there
 * is a real value for it — never an empty string or a placeholder — so an agent can read
 * absence as "nothing more is known".
 *
 * ONE HINT PER SYMBOL PER FILE. A signature is ~880 bytes of markdown and it is the SAME
 * bytes every time the symbol is misused, so repeats would spend the diagnostic budget
 * (`result/response-budget.ts`) restating one paragraph. The FIRST occurrence keeps it,
 * which is also the one truncation keeps: the cap retains the top of the file.
 */
export function enrichDiagnostics(
  inputs: readonly EnrichInput[],
  context: EnrichContext,
): ValidateCodeDiagnostic[] {
  const rendered = new Set<string>();

  return inputs.map(({ diagnostic, startIndex }) => {
    const enriched: ValidateCodeDiagnostic = { ...diagnostic };

    const url = checkDocs(diagnostic.check)?.url;
    if (url) enriched.see_also = url;

    const hint = hintFor(diagnostic.check, startIndex, context, rendered);
    if (hint) enriched.hint = hint;

    return enriched;
  });
}

/**
 * The rendered docset entry for the symbol at `offset`, when the docset publishes one and
 * this file has not already been shown it.
 *
 * NOTHING when it does not: a symbol the docset has never heard of has no signature to
 * show, and the engine's own `suggestions` are what help there.
 *
 * Searched from the offset OUTWARDS through the ancestors — `{% for x in y limit: 'ten' %}`
 * reports on the argument, and the `for` entry that answers it is three levels up.
 *
 * `rendered` is mutated only when a hint is actually produced, so an unpublished symbol
 * cannot consume the slot its name has and silence a later published one.
 */
function hintFor(
  check: string,
  offset: number | undefined,
  context: EnrichContext,
  rendered: Set<string>,
): string | undefined {
  if (!SIGNATURE_HINT_CHECKS.has(check)) return undefined;
  if (!context.ast || offset === undefined) return undefined;

  const symbol = documentedSymbolAt(context.ast, offset);
  if (!symbol) return undefined;

  const key = `${symbol.kind}:${symbol.name}`;
  if (rendered.has(key)) return undefined;

  const entry = entryFor(symbol, context.vocabulary);
  if (!entry) return undefined;

  rendered.add(key);
  return render(entry, undefined, symbol.kind);
}

/** The published entry for a symbol, matched by exact name within its own kind. */
function entryFor(
  symbol: DocumentedSymbol,
  vocabulary: DocsetVocabulary,
): FilterEntry | TagEntry | ObjectEntry | undefined {
  const entries =
    symbol.kind === 'filter'
      ? vocabulary.filters
      : symbol.kind === 'tag'
        ? vocabulary.tags
        : vocabulary.objects;

  return entries.find((entry) => entry.name === symbol.name);
}
