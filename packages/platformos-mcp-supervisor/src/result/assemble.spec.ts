import { describe, expect, it } from 'vitest';
import { assembleResult } from './assemble';
import type { ValidateCodeDiagnostic } from './types';

const diag = (over: Partial<ValidateCodeDiagnostic>): ValidateCodeDiagnostic => ({
  check: 'SomeCheck',
  severity: 'warning',
  message: 'msg',
  line: 1,
  column: 1,
  ...over,
});

describe('Unit: assembleResult', () => {
  it('buckets diagnostics by severity', () => {
    const result = assembleResult(
      [
        diag({ severity: 'error', check: 'E' }),
        diag({ severity: 'warning', check: 'W' }),
        diag({ severity: 'info', check: 'I' }),
      ],
      'full',
    );
    expect(result.errors.map((d) => d.check)).toEqual(['E']);
    expect(result.warnings.map((d) => d.check)).toEqual(['W']);
    expect(result.infos.map((d) => d.check)).toEqual(['I']);
  });

  it('derives status = error and must_fix_before_write when any error is present', () => {
    const result = assembleResult(
      [diag({ severity: 'error' }), diag({ severity: 'warning' })],
      'full',
    );
    expect(result.status).toEqual('error');
    expect(result.must_fix_before_write).toBe(true);
  });

  it('derives status = warning (no must_fix) when only warnings are present', () => {
    const result = assembleResult(
      [diag({ severity: 'warning' }), diag({ severity: 'info' })],
      'full',
    );
    expect(result.status).toEqual('warning');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('derives status = ok for no diagnostics or infos only', () => {
    expect(assembleResult([], 'full').status).toEqual('ok');
    expect(assembleResult([diag({ severity: 'info' })], 'full').status).toEqual('ok');
  });

  it('leaves the ergonomic/TASK-8 fields empty in this slice', () => {
    const result = assembleResult([diag({ severity: 'error' })], 'quick');
    expect(result.proposed_fixes).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.scorecard).toEqual([]);
    expect(result.tips).toEqual([]);
    expect(result.domain_guide).toBeNull();
    expect(result.structural).toBeNull();
    expect(result.parse_error).toBeNull();
  });
});
