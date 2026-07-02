import { describe, expect, it } from 'vitest';

import { AppCache } from '@platformos/platformos-check-node';

import { runValidateCode, type SupervisorContext } from './validate-code';
import { GraphCache } from '../graph-cache/graph-cache';
import type { ValidateCodeDiagnostic, ValidateCodeImpact } from '../result/types';

/**
 * The lint/impact orchestration contract in `runValidateCode`:
 * - lint is the PRIMARY signal — a lint failure propagates (the whole call fails);
 * - impact (blast radius) is SECONDARY enrichment — an impact failure degrades to
 *   `status: 'unavailable'` (logged) and never sinks the lint diagnostics.
 */
describe('runValidateCode: lint/impact orchestration', () => {
  const params = { file_path: 'app/views/partials/card.liquid', content: '<div></div>' };

  const warning: ValidateCodeDiagnostic = {
    check: 'SomeCheck',
    severity: 'warning',
    message: 'a warning',
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 5,
  };

  const impact: ValidateCodeImpact = {
    scope: 'direct',
    status: 'computed',
    dependents: { total: 1, by_kind: { render: 1 }, sample: ['app/views/pages/index.liquid'] },
  };

  // The cache is never exercised here — the impact adapter is faked — but the
  // context requires one; a bare cache (never triggered) satisfies the type.
  const makeCtx = (log: SupervisorContext['log'] = () => {}): SupervisorContext => ({
    projectDir: '/project',
    graphCache: new GraphCache({ rootUri: 'file:///project' }),
    appCache: new AppCache(),
    log,
  });

  it('passes lint diagnostics and impact straight through when both succeed', async () => {
    const result = await runValidateCode(makeCtx(), params, {
      lint: async () => [warning],
      impact: async () => impact,
    });

    expect(result).toEqual({
      status: 'warning',
      must_fix_before_write: false,
      errors: [],
      warnings: [warning],
      infos: [],
      proposed_fixes: [],
      clusters: [],
      scorecard: [],
      impact,
      parse_error: null,
      tips: [],
      domain_guide: null,
    });
  });

  it('degrades to an unavailable impact (and logs) when the impact adapter fails, preserving lint output', async () => {
    const logs: string[] = [];
    const result = await runValidateCode(
      makeCtx((message) => logs.push(message)),
      params,
      {
        lint: async () => [warning],
        impact: async () => {
          throw new Error('boom');
        },
      },
    );

    expect(result).toEqual({
      status: 'warning',
      must_fix_before_write: false,
      errors: [],
      warnings: [warning],
      infos: [],
      proposed_fixes: [],
      clusters: [],
      scorecard: [],
      impact: {
        scope: 'direct',
        status: 'unavailable',
        dependents: { total: 0, by_kind: {}, sample: [] },
      },
      parse_error: null,
      tips: [],
      domain_guide: null,
    });

    expect(logs).toEqual([
      `validate_code: ${params.file_path} (full)`,
      `validate_code: blast-radius failed for ${params.file_path}, continuing without impact: boom`,
    ]);
  });

  it('propagates a lint failure — the primary gate is never silently dropped', async () => {
    const failure = new Error('lint exploded');
    await expect(
      runValidateCode(makeCtx(), params, {
        lint: async () => {
          throw failure;
        },
        impact: async () => impact,
      }),
    ).rejects.toThrow(failure);
  });
});
