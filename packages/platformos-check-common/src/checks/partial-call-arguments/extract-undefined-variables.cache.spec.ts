import { describe, expect, it, vi } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { App } from '@platformos/platformos-common';

import { extractUndefinedVariables, undefinedVariablesOf } from './extract-undefined-variables';
import { sourceParsers } from '../../to-source-code';
import { MockFileSystem } from '../../test';

// Spy on the real parser so "how many times was this source parsed?" is
// observable. Everything else about the parser stays real. `vi.mock` is hoisted
// above the imports above, so both this module and the module under test see the
// spied export.
vi.mock('@platformos/liquid-html-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/liquid-html-parser')>();
  return { ...actual, toLiquidHtmlAST: vi.fn(actual.toLiquidHtmlAST) };
});

const parseCount = () => vi.mocked(toLiquidHtmlAST).mock.calls.length;

const ROOT = 'file:///project';
const PARTIAL = 'app/views/partials/card.liquid';

/** One file in an `App`, the way the engine hands one to a check. */
function appFile(source: string) {
  const fs = new MockFileSystem({ [PARTIAL]: source }, ROOT);
  const app = App.fromSources(ROOT, { [PARTIAL]: source }, fs, sourceParsers);
  return app.get(`${ROOT}/${PARTIAL}`)!;
}

/**
 * The analysis is memoized ON THE FILE, not in a cache of its own.
 *
 * That is what lets it be keyed by nothing but the in-scope names: the file already knows when
 * its source stops being true and drops the memo with the parse, and the `App` already evicts
 * files nobody is using — so there is no content key holding a second copy of every source, and
 * no eviction policy to tune. These pin both halves of that: it memoizes, and it lets go.
 */
describe('Unit: undefinedVariablesOf memoization', () => {
  it('analyzes a file once, however many call sites ask about it', () => {
    const file = appFile('{{ title }}{{ subtitle }}');
    const before = parseCount();

    const results = [
      undefinedVariablesOf(file),
      undefinedVariablesOf(file),
      undefinedVariablesOf(file),
    ];

    // One parse for the file itself, and no second analysis.
    expect(parseCount() - before).toEqual(1);
    const analysis = {
      required: ['title', 'subtitle'],
      optional: [],
      selfDefaulted: [],
      defined: [],
    };
    expect(results).toEqual([analysis, analysis, analysis]);
  });

  it('re-analyzes when the file is edited, so an open buffer is never served stale', () => {
    const file = appFile('{{ title }}');

    const before = undefinedVariablesOf(file);
    file.setSource('{{ title }}{{ author }}', 1);
    const after = undefinedVariablesOf(file);

    expect({ before, after }).toEqual({
      before: { required: ['title'], optional: [], selfDefaulted: [], defined: [] },
      after: { required: ['title', 'author'], optional: [], selfDefaulted: [], defined: [] },
    });
  });

  it('re-analyzes when the file is invalidated', () => {
    const file = appFile('{{ title }}');
    undefinedVariablesOf(file);
    const before = parseCount();

    file.invalidate();
    file.setSource('{{ other }}');

    expect(undefinedVariablesOf(file).required).toEqual(['other']);
    expect(parseCount() - before).toEqual(1);
  });

  it('keeps the analyses for different in-scope names apart', () => {
    const file = appFile('{{ app.foo }}{{ widget }}');

    expect({
      withoutGlobals: undefinedVariablesOf(file, []).required,
      withGlobals: undefinedVariablesOf(file, ['app']).required,
    }).toEqual({ withoutGlobals: ['app', 'widget'], withGlobals: ['widget'] });
  });

  it('hands every caller its own arrays, so one caller cannot corrupt another', () => {
    const file = appFile('{{ shared }}');

    undefinedVariablesOf(file).required.push('mutated');

    expect(undefinedVariablesOf(file).required).toEqual(['shared']);
  });

  /**
   * The escape hatch, for a source with no file behind it — a render target resolved outside
   * the walked subtrees. It computes every time, which is why callers holding a file use the
   * memoized form.
   */
  it('computes every time for a bare source, and takes a parse the caller already has', () => {
    const source = '{{ title }}';
    const ast = toLiquidHtmlAST(source);
    const before = parseCount();

    const results = [extractUndefinedVariables(source), extractUndefinedVariables(source, [], ast)];

    // The first parses; the second is handed the AST and parses nothing.
    expect(parseCount() - before).toEqual(1);
    expect(results).toEqual([
      { required: ['title'], optional: [], selfDefaulted: [], defined: [] },
      { required: ['title'], optional: [], selfDefaulted: [], defined: [] },
    ]);
  });
});
