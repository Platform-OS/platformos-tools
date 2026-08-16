import { allChecks } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';

import { BLOCKING_CHECKS, blocksWrite } from './blocking.js';
import type { ValidateCodeDiagnostic } from './types.js';

/**
 * `must_fix_before_write` is not `errors.length > 0`: check-common severities are
 * calibrated for a linter in an editor rather than for a write gate, so passing an argument
 * a partial does not declare is `Severity.ERROR` while platformOS ignores it and the page
 * renders fine. The gate answers only "will this file be broken if I write it?".
 */
const at = (check: string, severity: ValidateCodeDiagnostic['severity'] = 'error') => ({
  check,
  severity,
});

describe('Unit: blocksWrite', () => {
  describe('blocks on findings that mean the file will not work', () => {
    it.each([
      ['does not parse', 'LiquidHTMLSyntaxError'],
      ['does not parse, and the converter rejects the changeset', 'YAMLSyntaxError'],
      ['broken reference', 'MissingPartial'],
      ['platformOS raises on it', 'UnknownFilter'],
      ['a known filter, wrong argument count — same raise', 'FilterArity'],
      ['raises, and the deploy converter rejects the changeset', 'JsonLiteralQuoteStyle'],
      ['renders an empty page body', 'MissingContentForLayout'],
      ['a declared contract was violated', 'MissingRenderPartialArguments'],
      ['the query fails when executed', 'GraphQLCheck'],
      ['the query fails when executed', 'GraphQLVariablesCheck'],
      ['runtime error', 'InvalidWriteTarget'],
    ])('%s: %s', (_why, check) => {
      expect(blocksWrite([at(check)])).toBe(true);
    });
  });

  describe('does NOT block on findings the file survives', () => {
    it.each([
      // The reported bug. platformOS ignores an undeclared argument.
      ['a dead/unknown argument', 'PartialCallArguments'],
      ['the same dead argument, again', 'UnrecognizedRenderPartialArguments'],
      ['a missing key renders the key', 'TranslationKeyExists'],
      ['a missing key renders the key', 'MatchingTranslations'],
      ['resolves to nil', 'UnknownProperty'],
      ['doc hygiene, no runtime effect', 'UniqueDocParamNames'],
      ['doc hygiene, no runtime effect', 'ValidDocParamTypes'],
      // Both measured against a live instance: the page renders and returns HTTP 200.
      ['the asset 404s, the page is fine', 'MissingAsset'],
      ['visibly wrong, still a working page', 'ReservedVariableName'],
      ['performance advice', 'ImgWidthAndHeight'],
      ['performance advice', 'ParserBlockingScript'],
    ])('%s: %s', (_why, check) => {
      expect(blocksWrite([at(check)])).toBe(false);
    });
  });

  it('treats an UNRECOGNIZED check code as non-blocking', () => {
    // Load-bearing: check-common gains checks over time, and a gate that blocked on codes
    // it had never heard of would silently over-block every time the engine grew.
    expect(blocksWrite([at('SomeBrandNewCheck')])).toBe(false);
    expect(blocksWrite([at('community-extension:Whatever')])).toBe(false);
  });

  it('blocks when a blocking finding is MIXED IN with non-blocking ones', () => {
    expect(
      blocksWrite([
        at('PartialCallArguments'),
        at('ImgWidthAndHeight'),
        at('MissingPartial'), // the one that matters
        at('UnknownProperty'),
      ]),
    ).toBe(true);
  });

  it('does not block when every finding is non-blocking, however many', () => {
    expect(
      blocksWrite([
        at('PartialCallArguments'),
        at('UnrecognizedRenderPartialArguments'),
        at('ImgWidthAndHeight'),
        at('ParserBlockingScript'),
        at('UnknownProperty'),
      ]),
    ).toBe(false);
  });

  it('does not block on an empty list', () => {
    expect(blocksWrite([])).toBe(false);
  });

  it('ignores a blocking code carrying a NON-error severity', () => {
    // A check reconfigured down to warning in a project's config has been
    // deliberately de-escalated by its owner; the gate must respect that.
    expect(blocksWrite([at('MissingPartial', 'warning')])).toBe(false);
    expect(blocksWrite([at('MissingPartial', 'info')])).toBe(false);
    expect(blocksWrite([at('MissingPartial', 'error')])).toBe(true);
  });

  it('exposes the set so the membership decision is inspectable, not implicit', () => {
    // Pinned exactly: adding or removing an entry is a contract change to the write
    // gate and must be a deliberate edit here, not a side effect elsewhere.
    expect([...BLOCKING_CHECKS].sort()).toEqual([
      'FilterArity',
      'GraphQLCheck',
      'GraphQLVariablesCheck',
      'InvalidWriteTarget',
      'JsonLiteralQuoteStyle',
      'LiquidHTMLSyntaxError',
      'MissingContentForLayout',
      'MissingPartial',
      'MissingRenderPartialArguments',
      'UnknownFilter',
      'YAMLSyntaxError',
    ]);
  });

  it('does not block the two codes NO accepted buffer can ever produce', () => {
    // Removed on reachability, not on severity — both are `SourceCodeType.JSON` checks, and
    // this server never routes a JSON-typed file to anything. Pinned rather than merely
    // deleted because they READ as obviously belonging; the "every blocking check can
    // actually block" group in `transport/validate-code.spec.ts` holds the behavioural proof.
    expect([BLOCKING_CHECKS.has('ValidJSON'), BLOCKING_CHECKS.has('JSONSyntaxError')]).toEqual([
      false,
      false,
    ]);
  });

  /**
   * Three entries were measured against a live instance and found wrong. These pin the
   * corrections individually, so a future edit that "restores" one has to argue with the
   * evidence rather than silently reverting it.
   */
  it('does not block the two findings measured to render a working page', () => {
    expect(BLOCKING_CHECKS.has('MissingAsset')).toBe(false);
    expect(BLOCKING_CHECKS.has('ReservedVariableName')).toBe(false);
    expect(blocksWrite([at('MissingAsset'), at('ReservedVariableName')])).toBe(false);
  });

  it('blocks the JSON literal quote style, which is fatal at runtime AND on deploy', () => {
    expect(BLOCKING_CHECKS.has('JsonLiteralQuoteStyle')).toBe(true);
    expect(blocksWrite([at('JsonLiteralQuoteStyle')])).toBe(true);
  });

  /**
   * `InvalidWriteTarget` stays on its OWN evidence rather than a neighbour's shared
   * "runtime errors" justification, which measurement disproved for `ReservedVariableName`:
   * `hash_assign` against a number, string, boolean or range each raises
   * `HashAssignTagError`, while the object form it permits renders HTTP 200.
   */
  it('blocks the hash_assign target error, on its own measured evidence', () => {
    expect(BLOCKING_CHECKS.has('InvalidWriteTarget')).toBe(true);
    expect(blocksWrite([at('InvalidWriteTarget')])).toBe(true);
  });

  it('still reports a de-escalated finding as non-blocking, including the new member', () => {
    // The gate reads severity as well as code, so a project that downgrades
    // `JsonLiteralQuoteStyle` in its config is respected exactly like any other member.
    expect(blocksWrite([at('JsonLiteralQuoteStyle', 'warning')])).toBe(false);
  });

  it('does NOT contain the dead-argument checks — the bug this fixes', () => {
    expect(BLOCKING_CHECKS.has('PartialCallArguments')).toBe(false);
    expect(BLOCKING_CHECKS.has('UnrecognizedRenderPartialArguments')).toBe(false);
  });

  /**
   * `PartialCallArguments` reports two different things under ONE code: a dead argument
   * (harmless) and a missing required one (real). There is no structured discriminator on
   * the offense and non-goal #2 forbids regex over messages, so it is non-blocking
   * wholesale.
   */
  it('still blocks a missing required arg via the doc-based check', () => {
    expect(blocksWrite([at('MissingRenderPartialArguments'), at('PartialCallArguments')])).toBe(
      true,
    );
  });

  it('does not block a doc-less inferred requirement (documented trade-off)', () => {
    // Only PartialCallArguments fires for a doc-less partial. An inferred requirement is a
    // heuristic, and the failure mode is a nil value rather than a crash.
    expect(blocksWrite([at('PartialCallArguments')])).toBe(false);
  });
});

/**
 * The gate is POLICY, and policy about check codes goes stale silently.
 */
describe('Unit: BLOCKING_CHECKS is tied to the check registry', () => {
  const registered = new Set(allChecks.map((check) => check.meta.code));

  it('names only checks that exist in check-common', () => {
    expect([...BLOCKING_CHECKS].filter((code) => !registered.has(code)).sort()).toEqual([]);
  });

  /**
   * The CONVERSE is deliberately not asserted, and this test exists to say so rather than
   * leave the absence looking like an oversight.
   */
  it('does not require every registered check to be classified: silence is the default', () => {
    const unclassified = [...registered].filter((code) => !BLOCKING_CHECKS.has(code));

    // Most checks are not blocking, and that is the intended state, not a gap.
    expect(unclassified.length > 0).toBe(true);
    expect(blocksWrite([at(unclassified[0])])).toBe(false);
  });
});
