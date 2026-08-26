import { describe, expect, it } from 'vitest';
import { assembleNotApplicableResult, assembleResult } from './assemble.js';
import type { ValidateCodeDiagnostic, ValidateCodeImpact, ValidateCodeResult } from './types.js';

const diag = (over: Partial<ValidateCodeDiagnostic>): ValidateCodeDiagnostic => ({
  check: 'SomeCheck',
  severity: 'warning',
  message: 'msg',
  line: 1,
  column: 1,
  ...over,
});

// A neutral "not computed" impact used where the test does not exercise the
// cross-file comparison itself (it is threaded verbatim by assembleResult).
const NO_IMPACT: ValidateCodeImpact = { status: 'unavailable' };

// The always-empty envelope fields in this lint-only slice. Spread into each
// expected result so every assertion checks the WHOLE object, catching any
// field that unexpectedly starts being populated.
const EMPTY_ENVELOPE = {
  errors: [],
  warnings: [],
  infos: [],
  impact: NO_IMPACT,
} satisfies Partial<ValidateCodeResult>;

describe('Unit: assembleResult', () => {
  it('buckets diagnostics by severity into the full result', () => {
    const error = diag({ severity: 'error', check: 'E' });
    const warning = diag({ severity: 'warning', check: 'W' });
    const info = diag({ severity: 'info', check: 'I' });

    expect(assembleResult([error, warning, info], NO_IMPACT)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      // 'E' is not a blocking check code, so the file is reported as having an
      // error WITHOUT the write being gated — see the status/gate separation below.
      must_fix_before_write: false,
      errors: [error],
      warnings: [warning],
      infos: [info],
    });
  });

  it('derives status = error, and gates the write, for a BLOCKING error', () => {
    const error = diag({ severity: 'error', check: 'MissingPartial' });
    const warning = diag({ severity: 'warning' });

    expect(assembleResult([error, warning], NO_IMPACT)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [error],
      warnings: [warning],
    });
  });

  it('derives status = warning (no must_fix) when only warnings/infos are present', () => {
    const warning = diag({ severity: 'warning' });
    const info = diag({ severity: 'info' });

    expect(assembleResult([warning, info], NO_IMPACT)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'warning',
      must_fix_before_write: false,
      warnings: [warning],
      infos: [info],
    });
  });

  it('derives status = ok with an empty envelope for no diagnostics', () => {
    expect(assembleResult([], NO_IMPACT)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });
  });

  it('derives status = ok for infos only', () => {
    const info = diag({ severity: 'info' });

    expect(assembleResult([info], NO_IMPACT)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      infos: [info],
    });
  });

  /**
   * THE GATE ANSWERS FOR THE BUFFER, NOT FOR THE PROJECT.
   *
   * `must_fix_before_write` means "will THIS file be broken if I write it" — and a file can
   * be perfectly correct while its edit breaks three pages. Those pages need fixing too, but
   * blocking the write of a clean buffer is a different, wider claim than the one this flag
   * makes, and agents already act on the narrow one.
   *
   * So an `error`-severity finding in a DEPENDANT must not move it. The presence of `breaks`
   * is the signal for that; no second boolean restates it.
   */
  it('does NOT block the write when only a dependant broke, however severe', () => {
    const brokeSomeoneElse: ValidateCodeImpact = {
      status: 'computed',
      breaks: [
        {
          file: 'app/views/pages/home.liquid',
          diagnostics: [
            {
              check: 'MissingRenderPartialArguments',
              severity: 'error',
              message: "Missing required argument 'title'",
              line: 1,
              column: 11,
            },
          ],
        },
      ],
    };

    expect(assembleResult([], brokeSomeoneElse)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact: brokeSomeoneElse,
    });
  });

  it('carries the impact through verbatim (status unaffected by cross-file findings)', () => {
    const impact: ValidateCodeImpact = {
      status: 'computed',
      breaks: [
        {
          file: 'app/views/pages/index.liquid',
          diagnostics: [
            {
              check: 'MissingRenderPartialArguments',
              severity: 'error',
              message: 'missing required argument',
              line: 1,
              column: 1,
            },
          ],
        },
      ],
    };

    expect(assembleResult([], impact)).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      impact,
    });
  });
});

/**
 * The result carries ONLY fields that are actually populated.
 */
describe('Unit: the result contract carries no permanently-empty stubs', () => {
  const REMOVED = [
    'proposed_fixes',
    'clusters',
    'scorecard',
    'tips',
    'domain_guide',
    'parse_error',
  ];

  it('emits exactly the checked-result keys', () => {
    const result = assembleResult([diag({ severity: 'error' })], NO_IMPACT);

    expect(Object.keys(result).sort()).toEqual([
      'errors',
      'impact',
      'infos',
      'must_fix_before_write',
      'status',
      'warnings',
    ]);
  });

  it('emits exactly the not-applicable keys, adding only the two that explain the refusal', () => {
    const result = assembleNotApplicableResult({ code: 'ignored', reason: 'because' });

    expect(Object.keys(result).sort()).toEqual([
      'errors',
      'impact',
      'infos',
      'must_fix_before_write',
      'next_step',
      'not_applicable_reason',
      'status',
      'warnings',
    ]);
  });

  it.each(REMOVED)('does not emit the removed stub field %s', (field) => {
    const checked = assembleResult([], NO_IMPACT);
    const declined = assembleNotApplicableResult({ code: 'too_large', reason: 'r' });

    expect(field in checked).toBe(false);
    expect(field in declined).toBe(false);
  });

  it('survives a JSON round trip with no key reappearing', () => {
    // The wire format is what the agent actually sees: an `undefined` value would
    // vanish here, so this proves the keys are absent rather than merely undefined.
    const wire = JSON.parse(JSON.stringify(assembleResult([], NO_IMPACT)));

    expect(REMOVED.filter((field) => field in wire)).toEqual([]);
  });

  it('omits next_step and not_applicable_reason from a CHECKED result', () => {
    // The mirror of the above: these two exist only to explain a refusal, so a
    // checked file must not carry them either.
    const wire = JSON.parse(JSON.stringify(assembleResult([], NO_IMPACT)));

    expect(['next_step', 'not_applicable_reason'].filter((field) => field in wire)).toEqual([]);
  });
});

/**
 * `status` and `must_fix_before_write` answer DIFFERENT questions, and an agent depends on
 * reading them independently.
 */
describe('Unit: status and the write gate are separate signals', () => {
  const errorFrom = (check: string) => diag({ severity: 'error', check });

  it('reports status=error but does NOT gate on a non-blocking error', () => {
    // The reported bug, at the assembly layer.
    const result = assembleResult([errorFrom('PartialCallArguments')], NO_IMPACT);

    expect(result.status).toEqual('error');
    expect(result.must_fix_before_write).toBe(false);
    // Still fully reported — this is a de-escalation of the GATE, not suppression.
    expect(result.errors).toEqual([errorFrom('PartialCallArguments')]);
  });

  it('reports status=error AND gates on a blocking error', () => {
    const result = assembleResult([errorFrom('MissingPartial')], NO_IMPACT);

    expect([result.status, result.must_fix_before_write]).toEqual(['error', true]);
  });

  it('gates when a blocking error is mixed among non-blocking ones', () => {
    const result = assembleResult(
      [errorFrom('ImgWidthAndHeight'), errorFrom('MissingPartial'), errorFrom('UnknownProperty')],
      NO_IMPACT,
    );

    expect(result.must_fix_before_write).toBe(true);
    // And every one of them is still reported — nothing is dropped by the gate.
    expect(result.errors).toHaveLength(3);
  });

  it('never gates on warnings or infos, whatever the check', () => {
    const result = assembleResult(
      [
        diag({ severity: 'warning', check: 'MissingPartial' }),
        diag({ severity: 'info', check: 'MissingPartial' }),
      ],
      NO_IMPACT,
    );

    expect([result.status, result.must_fix_before_write]).toEqual(['warning', false]);
  });

  it('reports EVERY diagnostic, with no cap or truncation', () => {
    // An agent must see the whole picture; a silently truncated list would let it
    // "fix everything" and still be wrong.
    const many = Array.from({ length: 60 }, (_, i) =>
      diag({ severity: 'error', check: `Check${i}` }),
    );

    expect(assembleResult(many, NO_IMPACT).errors).toHaveLength(60);
  });
});

/**
 * Diagnostics are returned in READING ORDER (line, then column). `check()` batches by check
 * code, so the raw order is grouped by check — an `ImgWidthAndHeight` on line 5 arrives
 * before a `MissingPartial` on line 1, and an agent walking the list jumps around the file.
 */
describe('Unit: diagnostics are returned in reading order', () => {
  const at = (line: number, column: number, check = 'Check') =>
    diag({ severity: 'error', check, line, column });

  it('sorts by line', () => {
    const result = assembleResult([at(5, 1), at(1, 1), at(3, 1)], NO_IMPACT);

    expect(result.errors.map((e) => e.line)).toEqual([1, 3, 5]);
  });

  it('sorts by column within a line', () => {
    const result = assembleResult([at(2, 30), at(2, 5), at(2, 12)], NO_IMPACT);

    expect(result.errors.map((e) => e.column)).toEqual([5, 12, 30]);
  });

  it('breaks an exact-position tie by check code, deterministically', () => {
    // Without a stable tiebreak, byte-identical input could yield different output between
    // runs, undermining offense-comparison verification.
    const first = assembleResult([at(1, 1, 'Zebra'), at(1, 1, 'Alpha')], NO_IMPACT);
    const second = assembleResult([at(1, 1, 'Alpha'), at(1, 1, 'Zebra')], NO_IMPACT);

    expect(first.errors.map((e) => e.check)).toEqual(['Alpha', 'Zebra']);
    expect(first).toEqual(second);
  });

  it('orders each severity bucket independently', () => {
    const result = assembleResult(
      [
        diag({ severity: 'error', line: 9, column: 1, check: 'E' }),
        diag({ severity: 'warning', line: 8, column: 1, check: 'W' }),
        diag({ severity: 'error', line: 2, column: 1, check: 'E' }),
        diag({ severity: 'warning', line: 1, column: 1, check: 'W' }),
        diag({ severity: 'info', line: 7, column: 1, check: 'I' }),
        diag({ severity: 'info', line: 3, column: 1, check: 'I' }),
      ],
      NO_IMPACT,
    );

    expect(result.errors.map((d) => d.line)).toEqual([2, 9]);
    expect(result.warnings.map((d) => d.line)).toEqual([1, 8]);
    expect(result.infos.map((d) => d.line)).toEqual([3, 7]);
  });

  it('sorts the REAL grouped-by-check order the engine produces', () => {
    // The reported shape: check() emits ImgWidthAndHeight (line 5) before the two
    // MissingPartials (lines 1 and 2) because it batches per check.
    const result = assembleResult(
      [
        diag({ severity: 'error', check: 'ImgWidthAndHeight', line: 5, column: 1 }),
        diag({ severity: 'error', check: 'MissingPartial', line: 1, column: 11 }),
        diag({ severity: 'error', check: 'MissingPartial', line: 2, column: 11 }),
        diag({ severity: 'error', check: 'UnknownFilter', line: 3, column: 8 }),
        diag({ severity: 'error', check: 'PartialCallArguments', line: 4, column: 31 }),
      ],
      NO_IMPACT,
    );

    expect(result.errors.map((d) => `${d.line}:${d.column} ${d.check}`)).toEqual([
      '1:11 MissingPartial',
      '2:11 MissingPartial',
      '3:8 UnknownFilter',
      '4:31 PartialCallArguments',
      '5:1 ImgWidthAndHeight',
    ]);
  });

  it('does not mutate the caller’s array', () => {
    // assembleResult is documented as PURE; sorting in place would violate that and
    // could reorder a list the caller still holds.
    const input = [at(3, 1), at(1, 1)];
    const snapshot = [...input];

    assembleResult(input, NO_IMPACT);

    expect(input).toEqual(snapshot);
  });
});

/**
 * ORDER-INDEPENDENCE, stated as the property that can actually be violated: assembly is a
 * set of independent transforms over one input, not a chain where each step reads what the
 * last one wrote.
 */
describe('Unit: the result does not depend on the order diagnostics arrive in', () => {
  const d = (
    check: string,
    severity: ValidateCodeDiagnostic['severity'],
    line: number,
    column: number,
  ): ValidateCodeDiagnostic => ({ check, severity, message: `${check} fired`, line, column });

  const FINDINGS: ValidateCodeDiagnostic[] = [
    d('ImgWidthAndHeight', 'error', 5, 1), // non-blocking error
    d('UnknownProperty', 'warning', 2, 4),
    d('ParserBlockingScript', 'info', 9, 1),
    d('UnknownFilter', 'error', 2, 4), // exact tie with the warning above, on position
    d('MatchingTranslations', 'warning', 1, 1),
    d('MissingPartial', 'error', 12, 3), // BLOCKING, and last in input order
  ];

  /** Deterministic permutations — a fixed set, so a failure is reproducible. */
  const permutations: Array<[string, ValidateCodeDiagnostic[]]> = [
    ['as given', FINDINGS],
    ['reversed', [...FINDINGS].reverse()],
    ['grouped by check code', [...FINDINGS].sort((a, b) => a.check.localeCompare(b.check))],
    ['grouped by severity', [...FINDINGS].sort((a, b) => a.severity.localeCompare(b.severity))],
    ['rotated', [...FINDINGS.slice(3), ...FINDINGS.slice(0, 3)]],
  ];

  it('produces an identical result for every input permutation', () => {
    const results = permutations.map(([, input]) => assembleResult(input, NO_IMPACT));
    const [first, ...rest] = results;

    // Whole-value equality against the first, so a difference anywhere in the envelope
    // fails — not merely a difference in the lists.
    for (const result of rest) expect(result).toEqual(first);
  });

  it('gates identically however the blocking error is positioned', () => {
    expect(permutations.map(([name, input]) => [name, assembleResult(input, NO_IMPACT)])).toEqual(
      permutations.map(([name]) => [
        name,
        expect.objectContaining({ status: 'error', must_fix_before_write: true }),
      ]),
    );
  });

  it('resolves an exact-position tie the same way from either input order', () => {
    // `UnknownFilter` and `UnknownProperty` share 2:4 but sit in different buckets, so
    // the tie that matters is within one. Two errors at one position, both orders.
    const a = d('UnknownFilter', 'error', 2, 4);
    const b = d('MissingPartial', 'error', 2, 4);

    expect(assembleResult([a, b], NO_IMPACT).errors).toEqual(
      assembleResult([b, a], NO_IMPACT).errors,
    );
  });
});
