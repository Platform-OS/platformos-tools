import { describe, expect, it } from 'vitest';

import { BLOCKING_CHECKS, blocksWrite } from './blocking.js';
import type { ValidateCodeDiagnostic } from './types.js';

/**
 * TASK-19. `must_fix_before_write` was `errors.length > 0`, inheriting check-common
 * severities that are calibrated for a linter in an editor rather than for a write
 * gate. The reported symptom: passing an argument a partial does not declare is
 * `Severity.ERROR`, but platformOS ignores it and the page renders fine — so the
 * gate told an agent it must fix dead code before writing.
 *
 * The gate now answers only "will this file be broken if I write it?".
 */
const at = (check: string, severity: ValidateCodeDiagnostic['severity'] = 'error') => ({
  check,
  severity,
});

describe('Unit: blocksWrite', () => {
  describe('blocks on findings that mean the file will not work', () => {
    it.each([
      ['does not parse', 'LiquidHTMLSyntaxError'],
      ['does not parse', 'JSONSyntaxError'],
      ['invalid JSON', 'ValidJSON'],
      ['broken reference', 'MissingPartial'],
      ['platformOS raises on it', 'UnknownFilter'],
      ['raises, and the deploy converter rejects the changeset', 'JsonLiteralQuoteStyle'],
      ['renders an empty page body', 'MissingContentForLayout'],
      ['a declared contract was violated', 'MissingRenderPartialArguments'],
      ['the query fails when executed', 'GraphQLCheck'],
      ['the query fails when executed', 'GraphQLVariablesCheck'],
      ['runtime error', 'InvalidHashAssignTarget'],
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
    // Load-bearing. check-common gains checks over time and community extensions
    // contribute their own; a gate that blocked on codes it had never heard of
    // would silently over-block every time the engine grew.
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
      'GraphQLCheck',
      'GraphQLVariablesCheck',
      'InvalidHashAssignTarget',
      'JSONSyntaxError',
      'JsonLiteralQuoteStyle',
      'LiquidHTMLSyntaxError',
      'MissingContentForLayout',
      'MissingPartial',
      'MissingRenderPartialArguments',
      'UnknownFilter',
      'ValidJSON',
    ]);
  });

  /**
   * TASK-19.1. Three entries were measured against a live instance and found wrong.
   * These pin the corrections individually, so a future edit that "restores" one has
   * to argue with the evidence rather than silently reverting it.
   *
   * `MissingAsset`: `{{ 'no_such.css' | asset_url }}` renders, page HTTP 200, deploy
   * accepted — `asset_url` is string construction and never resolves the asset.
   * `ReservedVariableName`: `{% assign blank = 'oops' %}` renders `[]`, page HTTP 200.
   * `JsonLiteralQuoteStyle`: `{% assign o = {'k': 'v'} %}` raises `Invalid JSON in
   * assign` AND is rejected by `--dry-run`, failing the whole changeset.
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
   * `PartialCallArguments` reports two different things under ONE code: a dead
   * argument (harmless) and a missing required one (real). There is no structured
   * discriminator on the offense and non-goal #2 forbids regex over messages, so it
   * cannot be split here — it is non-blocking wholesale.
   *
   * That is only safe because the blocking half is covered independently, which was
   * verified against the real engine: a partial WITH a `{% doc %}` block also raises
   * `MissingRenderPartialArguments`. What stays unblocked is a DOC-LESS partial
   * whose required params are INFERRED from usage — deliberately, because blocking a
   * write on a heuristic is the false block this task removes.
   */
  it('still blocks a missing required arg via the doc-based check', () => {
    expect(blocksWrite([at('MissingRenderPartialArguments'), at('PartialCallArguments')])).toBe(
      true,
    );
  });

  it('does not block a doc-less inferred requirement (documented trade-off)', () => {
    // Only PartialCallArguments fires for a doc-less partial — verified against the
    // real engine. An inferred requirement is a heuristic, and the failure mode is a
    // nil value rather than a crash.
    expect(blocksWrite([at('PartialCallArguments')])).toBe(false);
  });
});
