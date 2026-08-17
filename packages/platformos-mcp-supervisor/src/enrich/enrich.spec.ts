/**
 * Enrichment is a pure function, so these run without a project, a server, or a lint.
 *
 * The AST is produced by parsing a snippet directly — the same parser the engine uses — so
 * the fixtures state exactly what an agent sent, and the offsets are the ones an offense
 * would carry.
 */
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { allChecks } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';

import { checkDocs } from '../check-docs.js';
import type { ValidateCodeDiagnostic } from '../result/types.js';
import { enrichDiagnostics, SIGNATURE_HINT_CHECKS, type DocsetVocabulary } from './enrich.js';

/**
 * A docset stand-in, deliberately tiny and DECLARED HERE.
 */
const VOCABULARY: DocsetVocabulary = {
  filters: [
    { name: 'hash_merge', description: 'Merges two hashes.', summary: 'Merge hashes.' },
  ] as DocsetVocabulary['filters'],
  tags: [{ name: 'for', description: 'Iterates over an array.' }] as DocsetVocabulary['tags'],
  objects: [
    { name: 'context', description: 'The request context.' },
  ] as DocsetVocabulary['objects'],
};

/**
 * What the shared renderer makes of each fixture entry, written out rather than derived.
 */
const REFERENCE = 'https://documentation.platformos.com/api-reference/liquid';
const RENDERED = {
  hash_merge: `### hash_merge\nMerge hashes.\n\nMerges two hashes.\n\n---\n\n[platformOS Reference](${REFERENCE}/filters#hash_merge)`,
  for: `### for\nIterates over an array.\n\n---\n\n[platformOS Reference](${REFERENCE}/loops#for)`,
  context: `### context\nThe request context.`,
};

const diagnostic = (check: string): ValidateCodeDiagnostic => ({
  check,
  severity: 'error',
  message: `${check} fired`,
  line: 1,
  column: 1,
});

const enrichOne = (
  check: string,
  source: string,
  startIndex?: number,
): ValidateCodeDiagnostic | undefined =>
  enrichDiagnostics([{ diagnostic: diagnostic(check), startIndex }], {
    ast: toLiquidHtmlAST(source),
    vocabulary: VOCABULARY,
  })[0];

describe('Unit: enrichDiagnostics', () => {
  it('attaches the check documentation URL, taken from the registry', () => {
    // Derived, not pasted: the expectation moves with the registry.
    const expected = checkDocs('FilterArity')?.url;
    expect(enrichOne('FilterArity', '{{ null | hash_merge }}', 8)?.see_also).toEqual(expected);
  });

  it('renders the published signature for a filter used wrongly', () => {
    const result = enrichOne('FilterArity', '{{ null | hash_merge }}', 8);

    expect(result?.hint).toEqual(RENDERED.hash_merge);
  });

  it('reaches an enclosing TAG when the offense is reported on its argument', () => {
    // `{% for x in (1..3) limit: 'ten' %}` — the offense lands on the string, three
    // levels below the tag whose entry answers it.
    const source = "{% for x in (1..3) limit: 'ten' %}{% endfor %}";
    const result = enrichOne('ValidTagArgumentTypes', source, source.indexOf("'ten'"));

    expect(result?.hint).toEqual(RENDERED.for);
  });

  it('renders an OBJECT entry, under the object kind', () => {
    // The third of the three kinds, and the one whose rendering differs visibly: an
    // object publishes no reference URL, so the entry ends at its description. Rendering
    // it as a filter would append a `/filters#context` link that goes nowhere.
    const result = enrichOne('ValidFilterArgumentTypes', '{{ context | hash_merge }}', 4);

    expect(result?.hint).toEqual(RENDERED.context);
  });

  /**
   * THE case that decided enrichment is opt-in per check. `{% render 'ghost' %}` resolves
   * to the `render` TAG, so rendering "whatever symbol is here" answered a missing-partial
   * error with ~500 bytes of general documentation about how `render` works, on a blocking
   * check that fires constantly, about a partial that is not a docset symbol at all.
   */
  it('adds NO signature for a check a signature does not answer', () => {
    const result = enrichOne('MissingPartial', "{% render 'ghost' %}", 10);

    expect(result?.hint).toBeUndefined();
    // ...but the documentation URL still attaches: that part is about the CHECK, and is
    // useful whatever the finding.
    expect(result?.see_also).toEqual(checkDocs('MissingPartial')?.url);
  });

  it('adds no signature for a symbol the docset does not publish', () => {
    // An unknown filter has no entry by definition — the engine's suggestions are the
    // answer there, and this must not invent a substitute.
    const result = enrichOne('ValidFilterArgumentTypes', '{{ x | no_such_filter_xyz: 1 }}', 6);

    expect(result?.hint).toBeUndefined();
  });

  it('leaves a diagnostic untouched when there is nothing to add', () => {
    // `CheckError` is check-common's code for "a check crashed on this file". It reaches an
    // agent as an ordinary offense and is NOT a registered check, so there is no
    // documentation URL for it — and with no tree there is no signature either. Every
    // optional field must be ABSENT rather than empty: an agent reads absence as "nothing
    // more is known".
    const [result] = enrichDiagnostics([{ diagnostic: diagnostic('CheckError'), startIndex: 0 }], {
      ast: undefined,
      vocabulary: VOCABULARY,
    });

    expect(result).toEqual({
      check: 'CheckError',
      severity: 'error',
      message: 'CheckError fired',
      line: 1,
      column: 1,
    });
  });

  /**
   * A repeated mistake must not buy a repeated paragraph. The signature is ~880 bytes and
   * identical every time, against a 32 KiB diagnostic budget: twenty of them once cost
   * 26 KiB and truncated the findings an agent actually needed. The FIRST occurrence keeps
   * the hint, which is also the one truncation keeps.
   */
  it('renders a symbol ONCE per file, however many findings name it', () => {
    const source = '{{ null | hash_merge }}{{ null | hash_merge }}{{ null | hash_merge }}';
    const results = enrichDiagnostics(
      [8, 31, 54].map((startIndex) => ({ diagnostic: diagnostic('FilterArity'), startIndex })),
      { ast: toLiquidHtmlAST(source), vocabulary: VOCABULARY },
    );

    // The later two keep their `see_also` — deduplication is about the bulk, not about
    // withholding the answer.
    expect(results.map((result) => [result.hint, result.see_also !== undefined])).toEqual([
      [RENDERED.hash_merge, true],
      [undefined, true],
      [undefined, true],
    ]);
  });

  it('renders each DISTINCT symbol, so deduplication cannot silence a second one', () => {
    // The control for the test above: a suppression keyed on anything coarser than the
    // symbol — "one hint per file", "one per check" — passes that one and fails this.
    const source = "{{ null | hash_merge }}{% for x in (1..3) limit: 'ten' %}{% endfor %}";
    const results = enrichDiagnostics(
      [
        { diagnostic: diagnostic('FilterArity'), startIndex: 8 },
        { diagnostic: diagnostic('ValidTagArgumentTypes'), startIndex: source.indexOf("'ten'") },
      ],
      { ast: toLiquidHtmlAST(source), vocabulary: VOCABULARY },
    );

    expect(results.map((result) => result.hint)).toEqual([RENDERED.hash_merge, RENDERED.for]);
  });

  /**
   * No offset means no symbol — never a symbol resolved at a guessed one.
   *
   * The offset is absent only when `startIndexes` got out of step with the diagnostics it
   * is index-aligned with, which is a bug rather than a state; the answer to it is the
   * finding with no hint, not the finding with a plausible wrong one.
   */
  it('adds no signature when the offense carries no offset', () => {
    const withoutOffset = enrichOne('FilterArity', '{{ null | hash_merge }}');

    // The control is the first test in this group: the same call WITH the offset renders.
    expect({ hint: withoutOffset?.hint, see_also: withoutOffset?.see_also !== undefined }).toEqual({
      hint: undefined,
      see_also: true,
    });
  });

  it('does not mutate its input', () => {
    const input = diagnostic('FilterArity');
    const before = { ...input };

    enrichDiagnostics([{ diagnostic: input, startIndex: 8 }], {
      ast: toLiquidHtmlAST('{{ null | hash_merge }}'),
      vocabulary: VOCABULARY,
    });

    expect(input).toEqual(before);
  });
});

describe('Unit: SIGNATURE_HINT_CHECKS', () => {
  /**
   * The same guard `BLOCKING_CHECKS` carries, for the same reason: a hand-written set of
   * check codes goes stale silently when one is renamed upstream, and a stale entry here
   * means a hint that quietly stopped appearing.
   */
  it('names only checks that are registered in check-common', () => {
    const registered = new Set(allChecks.map((check) => check.meta.code));
    expect([...SIGNATURE_HINT_CHECKS].filter((code) => !registered.has(code))).toEqual([]);
  });
});
