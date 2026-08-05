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

    expect(byFile.diagnostics.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('returns no diagnostics for a clean layout', async () => {
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body>{{ content_for_layout }}</body></html>' },
    ]);

    expect(byFile.diagnostics.get(LAYOUT)).toEqual([]);
  });

  it('returns an entry for every requested buffer, so "clean" is distinguishable from "not linted"', async () => {
    const clean = 'app/views/layouts/clean.liquid';
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body></body></html>' },
      { filePath: clean, content: '<html>{{ content_for_layout }}</html>' },
    ]);

    expect([...byFile.diagnostics.keys()].sort()).toEqual([clean, LAYOUT].sort());
    expect(byFile.diagnostics.get(clean)).toEqual([]);
    expect(byFile.diagnostics.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('accepts an absolute file path and keys the result by that same string', async () => {
    // Results are keyed by the CALLER's key, so a caller mixing relative and
    // absolute paths can find its own results without reproducing our normalization.
    const absolute = join(projectDir, LAYOUT);
    mkdirSync(dirname(absolute), { recursive: true });

    const byFile = await lint([{ filePath: absolute, content: '<html><body></body></html>' }]);

    expect(byFile.diagnostics.get(absolute)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('gives a relative and an absolute path for the SAME file identical diagnostics', async () => {
    const absolute = join(projectDir, LAYOUT);
    const content = '<html><body></body></html>';

    const byFile = await lint([
      { filePath: LAYOUT, content },
      { filePath: absolute, content },
    ]);

    expect(byFile.diagnostics.get(LAYOUT)).toEqual(byFile.diagnostics.get(absolute));
    expect(byFile.diagnostics.get(LAYOUT)).toEqual([MISSING_CONTENT_FOR_LAYOUT]);
  });

  it('returns an empty map for an empty request without touching the project', async () => {
    expect(await lint([])).toEqual({ diagnostics: new Map(), notChecked: new Map() });
  });
});

/**
 * Line endings must not change a single number an agent reads.
 *
 * This is the agent-facing half of a defect that lived in check-common's shared
 * offset-to-position mapping: a carriage return was counted as a character of the
 * line it terminates, so any diagnostic landing on a terminator came back one column
 * further right under CRLF than under LF. The language server never showed it — the
 * LSP clamps an over-long character to the end of the line — but this layer publishes
 * a 1-based column with no clamp, so it published a column the line did not have.
 *
 * Pinned HERE as well as in check-common because the two consumers disagree about
 * what the numbers mean (0-based there, 1-based after `toDiagnostic`), and a fix made
 * for one moves the other silently. The strongest statement is also the simplest:
 * byte-for-byte identical diagnostics, whichever way the file's lines end.
 */
describe('Integration: runBatchLint — CRLF and LF are indistinguishable', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-crlf-'));
    mkdirSync(join(projectDir, '.git'));
    writeFileSync(
      join(projectDir, '.platformos-check.yml'),
      [
        'extends: platformos-check:nothing',
        'YAMLSyntaxError:',
        '  enabled: true',
        'LiquidHTMLSyntaxError:',
        '  enabled: true',
        '',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const diagnose = async (filePath: string, content: string) => {
    const { diagnostics } = await runBatchLint({ projectDir, buffers: [{ filePath, content }] });
    return diagnostics.get(filePath);
  };

  /**
   * Each case is one source written twice, differing ONLY in line endings. The
   * fixtures deliberately span both defect classes: an offset landing on the
   * terminator, an offset at end of input, and a mid-line offset as the control that
   * proves nothing else moved.
   */
  const CASES: Array<{
    name: string;
    file: string;
    lf: string;
    expected: ValidateCodeDiagnostic[];
  }> = [
    {
      name: 'unclosed flow sequence (end of input)',
      file: 'app/schema/flow.yml',
      lf: 'c: [1, 2\n',
      expected: [
        {
          check: 'YAMLSyntaxError',
          severity: 'error',
          message:
            'Flow sequence in block collection must be sufficiently indented and end with a ]',
          line: 2,
          column: 1,
          end_line: 2,
          end_column: 1,
        },
      ],
    },
    {
      name: 'unterminated quote (end of input)',
      file: 'app/schema/quote.yml',
      lf: 'name: "oops\n',
      expected: [
        {
          check: 'YAMLSyntaxError',
          severity: 'error',
          message: 'Missing closing "quote',
          line: 2,
          column: 1,
          end_line: 2,
          end_column: 1,
        },
      ],
    },
    {
      name: 'tab indentation (mid-line — the control)',
      file: 'app/schema/tab.yml',
      lf: 'a:\n\tb: 1\n',
      expected: [
        {
          check: 'YAMLSyntaxError',
          severity: 'error',
          message: 'Tabs are not allowed as indentation',
          line: 2,
          column: 1,
          end_line: 2,
          end_column: 2,
        },
      ],
    },
    {
      name: 'unclosed liquid tag (span ending on the terminator)',
      file: 'app/views/pages/tag.liquid',
      lf: '{% if x \n',
      expected: [
        {
          check: 'LiquidHTMLSyntaxError',
          severity: 'error',
          message: 'SyntaxError: expected "%}"',
          line: 1,
          column: 9,
          end_line: 2,
          end_column: 1,
        },
      ],
    },
  ];

  for (const { name, file, lf, expected } of CASES) {
    it(`reports the same diagnostic under LF and CRLF — ${name}`, async () => {
      const crlfFile = file.replace(/\.(yml|liquid)$/, '_crlf.$1');

      expect({
        lf: await diagnose(file, lf),
        crlf: await diagnose(crlfFile, lf.replace(/\n/g, '\r\n')),
      }).toEqual({ lf: expected, crlf: expected });
    });
  }

  it('never publishes a column past the end of the line it points at', async () => {
    // The property the equalities above are instances of, stated directly so a future
    // fixture cannot satisfy LF === CRLF while both halves are wrong. A 1-based column
    // may be at most `line length + 1` — the end-of-line insertion point — with the
    // line measured WITHOUT its terminator.
    //
    // Every source here puts a diagnostic ON a terminator, which is the only place
    // the old mapping could overrun; a fixture whose diagnostic lands mid-line would
    // pass under the defect and assert nothing.
    const sources: Array<[string, string]> = [
      ['app/schema/bounds_flow.yml', 'c: [1, 2\r\n'],
      ['app/schema/bounds_quote.yml', 'name: "oops\r\n'],
      ['app/views/pages/bounds_tag.liquid', '{% if x \r\n'],
    ];

    const overruns = [];
    for (const [filePath, source] of sources) {
      const lines = source.split('\r\n');
      const diagnostics = (await diagnose(filePath, source)) ?? [];
      overruns.push(
        ...diagnostics
          .filter(({ line, column }) => column > (lines[line - 1] ?? '').length + 1)
          .map(({ check, line, column }) => ({ filePath, check, line, column })),
      );
    }

    expect(overruns).toEqual([]);
  });
});
