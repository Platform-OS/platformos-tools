import { describe, expect, it, vi } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { toLazySourceCode, toSourceCode } from './to-source-code';
import { SourceCodeType } from './types';

// Spy on the real parser so "was this parsed?" is observable. Everything else about
// the parser stays real. `vi.mock` is hoisted above the imports, so both this module
// and the module under test see the spied export.
vi.mock('@platformos/liquid-html-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/liquid-html-parser')>();
  return { ...actual, toLiquidHtmlAST: vi.fn(actual.toLiquidHtmlAST) };
});

const parseCount = () => vi.mocked(toLiquidHtmlAST).mock.calls.length;

const LIQUID = 'file:///app/views/pages/index.liquid';

describe('Unit: toLazySourceCode', () => {
  it('does not parse until `ast` is read', () => {
    const before = parseCount();

    const sourceCode = toLazySourceCode(LIQUID, '{{ title }}');

    // Reading the cheap fields must not trigger the parse.
    expect([sourceCode.uri, sourceCode.type, sourceCode.source]).toEqual([
      LIQUID,
      SourceCodeType.LiquidHtml,
      '{{ title }}',
    ]);
    expect(parseCount() - before).toEqual(0);

    void sourceCode.ast;
    expect(parseCount() - before).toEqual(1);
  });

  it('parses once however often `ast` is read', () => {
    const sourceCode = toLazySourceCode(LIQUID, '{{ title }}');
    const before = parseCount();

    const [first, second, third] = [sourceCode.ast, sourceCode.ast, sourceCode.ast];

    expect(parseCount() - before).toEqual(1);
    // The very same object each time — not merely an equal one.
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('produces the same result as the eager constructor', () => {
    const source = '{% render \'card\', title: "x" %}<div>{{ a }}</div>';

    expect(toLazySourceCode(LIQUID, source).ast).toEqual(toSourceCode(LIQUID, source).ast);
  });

  it('CAPTURES a parse error rather than throwing, exactly as the eager version does', () => {
    const broken = '{% if %}{{ ';

    // Constructing must not throw even though the source is malformed...
    const sourceCode = toLazySourceCode(LIQUID, broken);
    // ...and the error arrives as a value on first access.
    expect(() => sourceCode.ast).not.toThrow();
    expect(sourceCode.ast).toBeInstanceOf(Error);
    expect(toSourceCode(LIQUID, broken).ast).toBeInstanceOf(Error);
  });

  it('normalizes the uri and classifies every supported file type like the eager version', () => {
    const cases = [
      ['file:///a/b.liquid', SourceCodeType.LiquidHtml],
      ['file:///a/b.graphql', SourceCodeType.GraphQL],
      ['file:///a/b.yml', SourceCodeType.YAML],
      ['file:///a/b.yaml', SourceCodeType.YAML],
      ['file:///a/b.json', SourceCodeType.JSON],
    ] as const;

    for (const [uri, type] of cases) {
      const lazy = toLazySourceCode(uri, '{}');
      const eager = toSourceCode(uri, '{}');
      expect([lazy.uri, lazy.type]).toEqual([eager.uri, type]);
    }
  });

  it('survives being spread, which evaluates the getter into a plain value', () => {
    const sourceCode = toLazySourceCode(LIQUID, '{{ title }}');

    const copy = { ...sourceCode };

    expect(copy.ast).toEqual(sourceCode.ast);
    expect(Object.keys(copy)).toEqual(Object.keys({ ...toSourceCode(LIQUID, '{{ title }}') }));
  });

  it('carries `version` through like the eager version', () => {
    expect(toLazySourceCode(LIQUID, '{{ a }}', 7).version).toEqual(7);
    expect(toLazySourceCode(LIQUID, '{{ a }}').version).toBeUndefined();
  });
});
