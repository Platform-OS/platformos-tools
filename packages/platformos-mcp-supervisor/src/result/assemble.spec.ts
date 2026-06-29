import { describe, expect, it } from 'vitest';
import { assembleResult } from './assemble';
import type { ValidateCodeDependency, ValidateCodeDiagnostic, ValidateCodeResult } from './types';

const diag = (over: Partial<ValidateCodeDiagnostic>): ValidateCodeDiagnostic => ({
  check: 'SomeCheck',
  severity: 'warning',
  message: 'msg',
  line: 1,
  column: 1,
  ...over,
});

// The always-empty envelope fields in this lint-only slice. Spread into each
// expected result so every assertion checks the WHOLE object, catching any
// field that unexpectedly starts being populated.
const EMPTY_ENVELOPE = {
  errors: [],
  warnings: [],
  infos: [],
  proposed_fixes: [],
  clusters: [],
  scorecard: [],
  dependencies: [],
  parse_error: null,
  tips: [],
  domain_guide: null,
  structural: null,
} satisfies Partial<ValidateCodeResult>;

describe('Unit: assembleResult', () => {
  it('buckets diagnostics by severity into the full result', () => {
    const error = diag({ severity: 'error', check: 'E' });
    const warning = diag({ severity: 'warning', check: 'W' });
    const info = diag({ severity: 'info', check: 'I' });

    expect(assembleResult([error, warning, info], [], 'full')).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'error',
      must_fix_before_write: true,
      errors: [error],
      warnings: [warning],
      infos: [info],
    });
  });

  it('derives status = error and must_fix_before_write when any error is present', () => {
    const error = diag({ severity: 'error' });
    const warning = diag({ severity: 'warning' });

    expect(assembleResult([error, warning], [], 'full')).toEqual({
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

    expect(assembleResult([warning, info], [], 'full')).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'warning',
      must_fix_before_write: false,
      warnings: [warning],
      infos: [info],
    });
  });

  it('derives status = ok with an empty envelope for no diagnostics', () => {
    expect(assembleResult([], [], 'full')).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
    });
  });

  it('derives status = ok for infos only', () => {
    const info = diag({ severity: 'info' });

    expect(assembleResult([info], [], 'quick')).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      infos: [info],
    });
  });

  it('carries the dependencies through verbatim (status unaffected by deps)', () => {
    const dependencies: ValidateCodeDependency[] = [
      { kind: 'render', target: 'app/views/partials/card.liquid', line: 1, column: 1 },
      { kind: 'layout', target: 'app/views/layouts/theme.liquid', line: 3, column: 1 },
    ];

    expect(assembleResult([], dependencies, 'full')).toEqual({
      ...EMPTY_ENVELOPE,
      status: 'ok',
      must_fix_before_write: false,
      dependencies,
    });
  });
});
