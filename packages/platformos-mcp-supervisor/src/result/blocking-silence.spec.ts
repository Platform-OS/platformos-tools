import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { path as pathUtils } from '@platformos/platformos-check-common';
import { AppCache } from '@platformos/platformos-check-node';

import type { SupervisorContext } from '../context.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import type { ValidateCodeResult } from '../result/types.js';
import { runValidateCode } from '../transport/validate-code.js';

/**
 * The mirror of `blocking-emission.spec.ts`: where a blocking check must stay SILENT.
 *
 * Every guard in this repo asserted that checks FIRE — that each blocking code can be
 * produced, and that each admitted file type produces something. None asserted the
 * other direction, and that is precisely how a false block shipped: `yaml` defaults
 * `uniqueKeys` to `true`, so a duplicated key became `must_fix_before_write: true` for
 * a file `pos-cli deploy --dry-run` accepts. The check's docstring and the server's
 * agent-facing instructions both said duplicates are NOT reported. Both were measured
 * and correct. Neither could fail.
 *
 * The asymmetry is worth stating, because it is the reason this file is worth its
 * cost: a missed detection returns a broken file the agent discovers later, while a
 * false block is an unappealable refusal — the agent cannot write correct code and has
 * no override. Across four evaluation rounds the false-block count never moved, and
 * every one was found by an external evaluator with a live deploy oracle rather than
 * by this suite.
 *
 * SCOPE, STATED PLAINLY SO THE NAME DOES NOT OVERCLAIM. This file currently covers
 * ONE blocking code, `YAMLSyntaxError`. Deriving the covered set from
 * `BLOCKING_CHECKS` — so that adding a blocking code without must-stay-silent
 * coverage fails — is TASK-34, and this file is where that work belongs.
 *
 * WHAT MAKES A FIXTURE ADMISSIBLE HERE. Only input whose validity was ESTABLISHED, not
 * assumed. The duplicate-key shapes below were deployed individually through
 * `--dry-run` during the round-4 evaluation and accepted: a duplicate at the top
 * level, one inside a property, and one in a translation file.
 */
describe('Integration: a blocking check must stay silent on input the platform accepts', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-silence-'));
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const validate = async (filePath: string, content: string): Promise<ValidateCodeResult> => {
    const ctx: SupervisorContext = {
      projectDir,
      graphCache: new GraphCache({ rootUri: pathUtils.toUri(projectDir) }),
      appCache: new AppCache(),
      log: () => {},
    };
    return (await runValidateCode(ctx, { file_path: filePath, content })) as ValidateCodeResult;
  };

  const gate = async (filePath: string, content: string) => {
    const result = await validate(filePath, content);
    return {
      status: result.status,
      blocked: result.must_fix_before_write,
      errors: result.errors.map((error) => error.check),
    };
  };

  /** Both extensions `isSupportedSourceFile` admits, across every YAML file type. */
  const EVERY_YAML_FILE: string[] = [
    'app/schema/a.yml',
    'app/schema/a.yaml',
    'app/model_schemas/b.yml',
    'app/custom_model_types/c.yml',
    'app/transactable_types/d.yml',
    'app/user_profile_types/e.yml',
    'app/translations/en.yml',
    'app/translations/en.yaml',
  ];

  const DUPLICATE_SHAPES: Record<string, string> = {
    'a repeated key at the top level': 'name: car\nname: van\n',
    'a repeated key inside a property': 'name: car\nproperties:\n  make: ford\n  make: audi\n',
  };

  for (const [shape, content] of Object.entries(DUPLICATE_SHAPES)) {
    it(`does not refuse the write for ${shape}, in any admitted YAML file`, async () => {
      const gates = [];
      for (const filePath of EVERY_YAML_FILE) {
        gates.push(await gate(filePath, content));
      }

      // Whole-value, and identical for every file: the gate must not depend on which
      // YAML directory the buffer happens to live in.
      expect(gates).toEqual(
        EVERY_YAML_FILE.map(() => ({ status: 'ok', blocked: false, errors: [] })),
      );
    });
  }

  it('still refuses the write for YAML that genuinely does not parse', async () => {
    // The control this file cannot do without. An assertion that nothing was reported
    // is satisfied just as well by a check that stopped working, and a suppression
    // wide enough to hide a real parse failure would look identical above.
    const gates = [];
    for (const filePath of EVERY_YAML_FILE) {
      gates.push(await gate(filePath, 'name: car\nproperties: [unclosed\n'));
    }

    expect(gates).toEqual(
      EVERY_YAML_FILE.map(() => ({
        status: 'error',
        blocked: true,
        errors: ['YAMLSyntaxError'],
      })),
    );
  });
});
