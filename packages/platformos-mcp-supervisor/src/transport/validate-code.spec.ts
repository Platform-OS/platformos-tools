import { describe, expect, it } from 'vitest';

import { runValidateCode, type SupervisorContext } from './validate-code';
import type { StructureResult } from '../structure/structure';
import type {
  ValidateCodeDependency,
  ValidateCodeDiagnostic,
  ValidateCodeStructuralSnapshot,
} from '../result/types';

/**
 * The lint/structure orchestration contract in `runValidateCode`:
 * - lint is the PRIMARY signal — a lint failure propagates (the whole call fails);
 * - structure is SECONDARY enrichment — a structure failure degrades to empty
 *   `dependencies` + null `structural` (logged) and never sinks the lint diagnostics.
 */
describe('runValidateCode: lint/structure orchestration', () => {
  const params = { file_path: 'app/views/pages/index.liquid', content: "{% render 'card' %}" };

  const warning: ValidateCodeDiagnostic = {
    check: 'SomeCheck',
    severity: 'warning',
    message: 'a warning',
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 5,
  };

  const dependency: ValidateCodeDependency = {
    kind: 'render',
    target: 'app/views/partials/card.liquid',
    line: 1,
    column: 1,
  };

  const structural: ValidateCodeStructuralSnapshot = {
    renders_used: ['card'],
    graphql_queries_used: [],
    filters_used: [],
    tags_used: ['render'],
    translation_keys: [],
    doc_params: [],
    slug: '/',
    layout: null,
    method: null,
  };

  const structureOk: StructureResult = { dependencies: [dependency], structural };

  const makeCtx = (log: SupervisorContext['log'] = () => {}): SupervisorContext => ({
    projectDir: '/project',
    log,
  });

  it('passes lint diagnostics, dependencies, and structural straight through when both succeed', async () => {
    const result = await runValidateCode(makeCtx(), params, {
      lint: async () => [warning],
      structure: async () => structureOk,
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
      dependencies: [dependency],
      parse_error: null,
      tips: [],
      domain_guide: null,
      structural,
    });
  });

  it('degrades to empty dependencies + null structural (and logs) when the structure adapter fails, preserving lint output', async () => {
    const logs: string[] = [];
    const result = await runValidateCode(
      makeCtx((message) => logs.push(message)),
      params,
      {
        lint: async () => [warning],
        structure: async () => {
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
      dependencies: [],
      parse_error: null,
      tips: [],
      domain_guide: null,
      structural: null,
    });

    expect(logs).toEqual([
      `validate_code: ${params.file_path} (full)`,
      `validate_code: structural resolution failed for ${params.file_path}, ` +
        `continuing without structure: boom`,
    ]);
  });

  it('propagates a lint failure — the primary gate is never silently dropped', async () => {
    const failure = new Error('lint exploded');
    await expect(
      runValidateCode(makeCtx(), params, {
        lint: async () => {
          throw failure;
        },
        structure: async () => structureOk,
      }),
    ).rejects.toThrow(failure);
  });
});
