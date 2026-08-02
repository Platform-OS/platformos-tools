import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import {
  clearUndefinedVariablesCache,
  extractUndefinedVariables,
} from './extract-undefined-variables';

// Spy on the real parser so "how many times was this source parsed?" is
// observable. Everything else about the parser stays real. `vi.mock` is hoisted
// above the imports above, so both this module and the module under test see the
// spied export.
vi.mock('@platformos/liquid-html-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/liquid-html-parser')>();
  return { ...actual, toLiquidHtmlAST: vi.fn(actual.toLiquidHtmlAST) };
});

const parseCount = () => vi.mocked(toLiquidHtmlAST).mock.calls.length;

describe('Unit: extractUndefinedVariables memoization', () => {
  // The cache is module-global, so every test here starts from a cold one.
  // Without this, a test that happens to use the same source as an earlier one
  // would see 0 parses and fail as though the memoization were broken.
  beforeEach(() => {
    clearUndefinedVariablesCache();
  });

  it('parses a given source once, however many call sites ask about it', () => {
    const source = '{{ title }}{{ subtitle }}';
    const before = parseCount();

    const results = [
      extractUndefinedVariables(source),
      extractUndefinedVariables(source),
      extractUndefinedVariables(source),
    ];

    expect(parseCount() - before).toEqual(1);
    const analysis = {
      required: ['title', 'subtitle'],
      optional: [],
      selfDefaulted: [],
      defined: [],
    };
    expect(results).toEqual([analysis, analysis, analysis]);
  });

  it('re-analyzes when the source changes, so an edited partial is never served stale', () => {
    const before = parseCount();

    const first = extractUndefinedVariables('{{ title }}');
    const second = extractUndefinedVariables('{{ title }}{{ author }}');

    expect(parseCount() - before).toEqual(2);
    expect(first).toEqual({ required: ['title'], optional: [], selfDefaulted: [], defined: [] });
    expect(second).toEqual({
      required: ['title', 'author'],
      optional: [],
      selfDefaulted: [],
      defined: [],
    });
  });

  it('re-analyzes when the in-scope global names change for the same source', () => {
    const source = '{{ app.foo }}{{ widget }}';
    const before = parseCount();

    const withoutGlobals = extractUndefinedVariables(source, []);
    const withGlobals = extractUndefinedVariables(source, ['app']);

    expect(parseCount() - before).toEqual(2);
    expect(withoutGlobals).toEqual({
      required: ['app', 'widget'],
      optional: [],
      selfDefaulted: [],
      defined: [],
    });
    expect(withGlobals).toEqual({
      required: ['widget'],
      optional: [],
      selfDefaulted: [],
      defined: [],
    });
  });

  it('spends no parse at all when the caller already holds the AST of that source', () => {
    const source = '{{ title }}';
    const ast = toLiquidHtmlAST(source);
    const before = parseCount();

    const result = extractUndefinedVariables(source, [], ast);

    expect(parseCount() - before).toEqual(0);
    expect(result).toEqual({ required: ['title'], optional: [], selfDefaulted: [], defined: [] });
  });

  it('hands every caller its own arrays, so one caller cannot corrupt another', () => {
    const source = '{{ shared }}';

    const first = extractUndefinedVariables(source);
    first.required.push('mutated');
    const second = extractUndefinedVariables(source);

    expect(second).toEqual({ required: ['shared'], optional: [], selfDefaulted: [], defined: [] });
  });
});
