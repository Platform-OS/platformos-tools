import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runBatchLint } from './lint-batch.js';
import type { AgentEdit, ValidateCodeDiagnostic } from '../result/types.js';

/**
 * Adapter integration: drives the real check-node `lintBuffers` against a temp
 * project. Hermetic config (`extends: platformos-check:nothing` + one check) keeps
 * the assertions deterministic and docset/network-free.
 */
describe('Integration: runBatchLint (the lint adapter)', () => {
  let projectDir: string;

  // The exact diagnostic the enabled MissingContentForLayout check produces for a layout
  // that omits `{{ content_for_layout }}`, reported at offset 0 (1-based line/column 1).
  const missingContentForLayout = (insertAt: number): ValidateCodeDiagnostic => ({
    check: 'MissingContentForLayout',
    severity: 'error',
    message:
      "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
    line: 1,
    column: 1,
    end_line: 1,
    end_column: 1,
    suggestions: [
      {
        description: 'Insert `{{ content_for_layout }}` before the closing </body> tag',
        edits: [
          { start_index: insertAt, end_index: insertAt, new_text: '{{ content_for_layout }}\n' },
        ],
      },
    ],
  });

  /** `<html><body><header>Site</header>` — the offset of `</body>` in the longer fixture. */
  const INSERT_AFTER_HEADER = 33;
  /** `<html><body>` — the offset of `</body>` in the bare fixture. */
  const INSERT_BARE_BODY = 12;

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

    expect(byFile.diagnostics.get(LAYOUT)).toEqual([missingContentForLayout(INSERT_AFTER_HEADER)]);
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
    expect(byFile.diagnostics.get(LAYOUT)).toEqual([missingContentForLayout(INSERT_BARE_BODY)]);
  });

  it('accepts an absolute file path and keys the result by that same string', async () => {
    // Results are keyed by the CALLER's key, so a caller mixing relative and
    // absolute paths can find its own results without reproducing our normalization.
    const absolute = join(projectDir, LAYOUT);
    mkdirSync(dirname(absolute), { recursive: true });

    const byFile = await lint([{ filePath: absolute, content: '<html><body></body></html>' }]);

    expect(byFile.diagnostics.get(absolute)).toEqual([missingContentForLayout(INSERT_BARE_BODY)]);
  });

  it('gives a relative and an absolute path for the SAME file identical diagnostics', async () => {
    const absolute = join(projectDir, LAYOUT);
    const content = '<html><body></body></html>';

    const byFile = await lint([
      { filePath: LAYOUT, content },
      { filePath: absolute, content },
    ]);

    expect(byFile.diagnostics.get(LAYOUT)).toEqual(byFile.diagnostics.get(absolute));
    expect(byFile.diagnostics.get(LAYOUT)).toEqual([missingContentForLayout(INSERT_BARE_BODY)]);
  });

  /**
   * `sources` is optional on the TYPE, for the benefit of test stubs; the real adapter has
   * no such licence.
   */
  it('populates sources for every file it reports diagnostics for, index-aligned', async () => {
    const clean = 'app/views/layouts/clean.liquid';
    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body></body></html>' },
      { filePath: clean, content: '<html>{{ content_for_layout }}</html>' },
    ]);

    expect(
      [...byFile.diagnostics].map(([key, diagnostics]) => ({
        key,
        hasSource: byFile.sources?.has(key) ?? false,
        aligned: byFile.sources?.get(key)?.startIndexes.length === diagnostics.length,
      })),
    ).toEqual([
      { key: LAYOUT, hasSource: true, aligned: true },
      { key: clean, hasSource: true, aligned: true },
    ]);
  });

  /**
   * `sources.ast` is the tree of the BUFFER, and the reason `LintBufferResult` hands one
   * back instead of letting a caller read the `App` afterwards: the overlay is reverted
   * before this returns, so a tree fetched later describes DISK — right on every unchanged
   * file and wrong on exactly the ones being edited.
   */
  it('returns the tree of the BUFFER, not of the file on disk', async () => {
    const absolute = join(projectDir, LAYOUT);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '<html><body>{{ x | on_disk_filter }}</body></html>', 'utf8');

    const byFile = await lint([
      { filePath: LAYOUT, content: '<html><body>{{ x | in_buffer_filter }}</body></html>' },
    ]);

    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const candidate = node as { type?: string; name?: unknown };
      if (candidate.type === 'LiquidFilter' && typeof candidate.name === 'string') {
        names.push(candidate.name);
      }
      for (const value of Object.values(node as Record<string, unknown>)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    };
    walk(byFile.sources?.get(LAYOUT)?.ast);

    expect(names).toEqual(['in_buffer_filter']);
  });

  it('returns an empty map for an empty request without touching the project', async () => {
    expect(await lint([])).toEqual({
      diagnostics: new Map(),
      sources: new Map(),
      notChecked: new Map(),
    });
  });
});

/**
 * The engine's structured fixes have to REACH the agent.
 */
describe('Integration: runBatchLint — structured fixes and suggestions', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-fixes-'));
    mkdirSync(join(projectDir, '.git'));
    writeFileSync(
      join(projectDir, '.platformos-check.yml'),
      `extends: platformos-check:nothing
JsonLiteralQuoteStyle:
  enabled: true
DeprecatedTag:
  enabled: true
DeprecatedFilter:
  enabled: true
ParserBlockingScript:
  enabled: true
`,
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

  /** Apply edits back-to-front, so earlier offsets are not shifted by later inserts. */
  const applyEdits = (source: string, edits: AgentEdit[]) =>
    [...edits]
      .sort((a, b) => b.start_index - a.start_index)
      .reduce(
        (out, edit) => out.slice(0, edit.start_index) + edit.new_text + out.slice(edit.end_index),
        source,
      );

  it('carries a single-edit autofix, with offsets into the buffer', async () => {
    const source = "{% assign o = {'k': 1} %}{{ o }}";

    expect(await diagnose('app/views/pages/json.liquid', source)).toEqual([
      {
        check: 'JsonLiteralQuoteStyle',
        severity: 'error',
        message:
          'Use double quotes for string literals inside object/array literals (e.g. \'{"key": "value"}\', not "{\'key\': \'value\'}").',
        line: 1,
        column: 16,
        end_line: 1,
        end_column: 19,
        fix: { edits: [{ start_index: 15, end_index: 18, new_text: '"k"' }] },
      },
    ]);
  });

  /**
   * THE case that decided `AgentFix.edits` is a list rather than one edit.
   */
  it('carries BOTH edits of a block-tag rename, and applying them produces valid source', async () => {
    const source = '{% try_rc %}{% assign z = 1 %}{% endtry_rc %}';
    const diagnostics = (await diagnose('app/views/pages/block.liquid', source)) ?? [];

    expect(diagnostics).toEqual([
      {
        check: 'DeprecatedTag',
        severity: 'warning',
        message: "Deprecated tag 'try_rc': Use {% try %} instead.",
        line: 1,
        column: 4,
        end_line: 1,
        end_column: 10,
        fix: {
          edits: [
            { start_index: 3, end_index: 9, new_text: 'try' },
            { start_index: 33, end_index: 42, new_text: 'endtry' },
          ],
        },
      },
    ]);

    // The edits are not merely present — they are correct. Applying them renames both
    // halves, which is the only reason the fix is safe to hand an agent.
    expect(applyEdits(source, diagnostics[0].fix!.edits)).toEqual(
      '{% try %}{% assign z = 1 %}{% endtry %}',
    );
  });

  it('carries every suggestion the engine offers, each with its own description', async () => {
    const source = '<script src="a.js"></script>';

    expect(await diagnose('app/views/pages/script.liquid', source)).toEqual([
      {
        check: 'ParserBlockingScript',
        severity: 'error',
        message: 'Avoid parser blocking scripts by adding `defer` or `async` on this tag',
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 29,
        suggestions: [
          {
            description: 'Use an HTML script tag with the defer attribute instead',
            edits: [{ start_index: 18, end_index: 18, new_text: ' defer' }],
          },
          {
            description: 'Use an HTML script tag with the async attribute instead',
            edits: [{ start_index: 18, end_index: 18, new_text: ' async' }],
          },
        ],
      },
    ]);
  });

  /**
   * The CONTROL for every assertion above: a diagnostic the engine offers nothing for comes
   * back with neither key. `DeprecatedFilter` on `parse_json` is that case — upstream
   * publishes no successor filter, so the check reports without a fix.
   */
  it('omits fix and suggestions entirely when the engine offered neither', async () => {
    expect(await diagnose('app/views/pages/nofix.liquid', "{{ 'x' | parse_json }}")).toEqual([
      {
        check: 'DeprecatedFilter',
        severity: 'warning',
        message: "Deprecated filter 'parse_json'.",
        line: 1,
        column: 8,
        end_line: 1,
        end_column: 20,
      },
    ]);
  });

  /**
   * Offsets index the BUFFER, never the file on disk.
   */
  it('computes edits against the sent buffer, not the file on disk', async () => {
    const filePath = 'app/views/pages/stale.liquid';
    const onDisk = join(projectDir, filePath);
    mkdirSync(dirname(onDisk), { recursive: true });
    writeFileSync(
      onDisk,
      "{% comment %}padding padding{% endcomment %}{% assign o = {'k': 1} %}",
      'utf8',
    );

    const buffer = "{% assign o = {'k': 1} %}";
    const diagnostics = (await diagnose(filePath, buffer)) ?? [];

    expect(diagnostics.map((d) => d.fix)).toEqual([
      { edits: [{ start_index: 15, end_index: 18, new_text: '"k"' }] },
    ]);
    expect(applyEdits(buffer, diagnostics[0].fix!.edits)).toEqual('{% assign o = {"k": 1} %}');
  });
});

/**
 * ONE lint pass per request, and the correctness that follows from it.
 */
describe('Integration: runBatchLint — one pass, one shared view of the project', () => {
  let projectDir: string;

  const CALLER = 'app/views/pages/home.liquid';
  const PARTIAL = 'app/views/partials/brand_new.liquid';
  const CALLER_SOURCE = "{% render 'brand_new' %}";
  const PARTIAL_SOURCE = '<div>hello</div>';

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-batch-'));
    mkdirSync(join(projectDir, '.git'));
    writeFileSync(
      join(projectDir, '.platformos-check.yml'),
      ['extends: platformos-check:nothing', 'MissingPartial:', '  enabled: true', ''].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('resolves a partial created in the SAME request, so a coherent changeset is not reported broken', async () => {
    const { diagnostics } = await runBatchLint({
      projectDir,
      buffers: [
        { filePath: CALLER, content: CALLER_SOURCE },
        { filePath: PARTIAL, content: PARTIAL_SOURCE },
      ],
    });

    expect({ caller: diagnostics.get(CALLER), partial: diagnostics.get(PARTIAL) }).toEqual({
      caller: [],
      partial: [],
    });
  });

  it('CONTROL: the same caller sent alone IS reported as rendering a missing partial', async () => {
    const { diagnostics } = await runBatchLint({
      projectDir,
      buffers: [{ filePath: CALLER, content: CALLER_SOURCE }],
    });

    expect(diagnostics.get(CALLER)).toEqual([
      {
        check: 'MissingPartial',
        severity: 'error',
        message: "'brand_new' does not exist",
        line: 1,
        column: 11,
        end_line: 1,
        end_column: 22,
      },
    ]);
  });
});

/**
 * Line endings must not change a single number an agent reads.
 */
describe('Integration: runBatchLint — CRLF and LF are indistinguishable', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-crlf-'));
    mkdirSync(join(projectDir, '.git'));
    writeFileSync(
      join(projectDir, '.platformos-check.yml'),
      `extends: platformos-check:nothing
YAMLSyntaxError:
  enabled: true
LiquidHTMLSyntaxError:
  enabled: true
`,
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
    // fixture cannot satisfy LF === CRLF while both halves are wrong. A 1-based column may
    // be at most `line length + 1` — the end-of-line insertion point — with the line
    // measured WITHOUT its terminator. Every source here puts a diagnostic ON a terminator,
    // which is the only place the old mapping could overrun.
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
