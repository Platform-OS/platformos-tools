import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLint } from './lint';

/**
 * Adapter integration: drives the real check-node `lintBuffer` against a temp
 * project. Hermetic config (`extends: platformos-check:nothing` + one check)
 * keeps the assertions deterministic and docset/network-free.
 */
describe('Integration: runLint (lint adapter)', () => {
  let projectDir: string;

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

  it('maps a real offense to a diagnostic (check, severity, 1-based range)', async () => {
    const diagnostics = await runLint({
      projectDir,
      filePath: 'app/views/layouts/application.liquid',
      content: '<html><body><header>Site</header></body></html>',
    });

    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.check).toEqual('MissingContentForLayout');
    expect(d.severity).toEqual('error');
    expect(typeof d.line).toBe('number');
    expect(typeof d.column).toBe('number');
    expect(d.line).toBeGreaterThanOrEqual(1);
    expect(d.column).toBeGreaterThanOrEqual(1);
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

    expect(diagnostics.some((d) => d.check === 'MissingContentForLayout')).toBe(true);
  });
});
