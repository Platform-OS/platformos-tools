import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLint } from './lint.js';
import type { ValidateCodeDiagnostic } from '../result/types.js';

/**
 * Adapter integration: drives the real check-node `lintBuffer` against a temp
 * project. Hermetic config (`extends: platformos-check:nothing` + one check)
 * keeps the assertions deterministic and docset/network-free.
 */
describe('Integration: runLint (lint adapter)', () => {
  let projectDir: string;

  // The exact diagnostic the enabled MissingContentForLayout check produces for
  // a layout that omits `{{ content_for_layout }}`. The check reports at
  // startIndex/endIndex 0, which maps to 1-based line/column 1.
  const MISSING_CONTENT_FOR_LAYOUT: ValidateCodeDiagnostic = {
    check: 'MissingContentForLayout',
    severity: 'error',
    message:
      "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 1,
  };

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-lint-'));
    mkdirSync(join(projectDir, '.git'));
    writeFileSync(
      join(projectDir, '.platformos-check.yml'),
      ['extends: platformos-check:nothing', 'MissingContentForLayout:', '  enabled: true', ''].join(
        '\n',
      ),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('maps a real offense to the exact diagnostic (check, severity, message, 1-based range)', async () => {
    const diagnostics = await runLint({
      projectDir,
      filePath: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(diagnostics).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('returns no diagnostics for a clean layout', async () => {
    const diagnostics = await runLint({
      projectDir,
      filePath: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>',
    });

    expect(diagnostics).toEqual([]);
  });

  it('accepts an absolute file path', async () => {
    const absolute = join(projectDir, 'app/views/layouts/application.liquid');
    mkdirSync(dirname(absolute), { recursive: true });

    const diagnostics = await runLint({
      projectDir,
      filePath: absolute,
      content: '<html><body></body></html>',
    });

    expect(diagnostics).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });
});
