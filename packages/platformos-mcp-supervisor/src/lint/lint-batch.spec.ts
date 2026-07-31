import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runBatchLint } from './lint-batch.js';
import type { ValidateCodeDiagnostic } from '../result/types.js';

/**
 * Adapter integration: drives the real check-node `lintBuffers` against a temp
 * project. Hermetic config (`extends: platformos-check:nothing` + one check) keeps
 * the assertions deterministic and docset/network-free.
 *
 * This is the ONLY lint adapter — the orchestrator always works on a list, so a
 * single file is a one-element batch. These assertions therefore cover the
 * single-file path too; there is no separate one to diverge from.
 */
describe('Integration: runBatchLint (the lint adapter)', () => {
  let projectDir: string;

  // The exact diagnostic the enabled MissingContentForLayout check produces for a
  // layout that omits `{{ content_for_layout }}`. The check reports at
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

  const LAYOUT = 'app/views/layouts/application.liquid';

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

  const lint = (buffers: Array<{ filePath: string; content: string }>) =>
    runBatchLint({ projectDir, buffers });

  it('maps a real offense to the exact diagnostic (check, severity, message, 1-based range)', async () => {
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body><header>Site</header></body></html>' },
    ]);

    expect(byFile.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('returns no diagnostics for a clean layout', async () => {
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body>{{ content_for_layout }}</body></html>' },
    ]);

    expect(byFile.get(LAYOUT)).toEqual([]);
  });

  it('returns an entry for every requested buffer, so "clean" is distinguishable from "not linted"', async () => {
    const clean = 'app/views/layouts/clean.liquid';
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body></body></html>' },
      { filePath: clean, content: '<html>{{ content_for_layout }}</html>' },
    ]);

    expect([...byFile.keys()].sort()).toEqual([clean, LAYOUT].sort());
    expect(byFile.get(clean)).toEqual([]);
    expect(byFile.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('accepts an absolute file path and keys the result by that same string', async () => {
    // Results are keyed by the CALLER's key, so a caller mixing relative and
    // absolute paths can find its own results without reproducing our normalization.
    const absolute = join(projectDir, LAYOUT);
    mkdirSync(dirname(absolute), { recursive: true });

    const byFile = await lint([{ filePath: absolute, content: '<html><body></body></html>' }]);

    expect(byFile.get(absolute)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('gives a relative and an absolute path for the SAME file identical diagnostics', async () => {
    const absolute = join(projectDir, LAYOUT);
    const content = '<html><body></body></html>';

    const byFile = await lint([
      { filePath: LAYOUT, content },
      { filePath: absolute, content },
    ]);

    expect(byFile.get(LAYOUT)).toEqual(byFile.get(absolute));
    expect(byFile.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('returns an empty map for an empty request without touching the project', async () => {
    expect(await lint([])).toEqual(new Map());
  });
});
