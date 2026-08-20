import { describe, expect, it } from 'vitest';
import { findUnsupportedStringEscapes } from './detect';

/**
 * The scanner reads RAW markup -- the markup the strict grammar refused -- so every fixture
 * here is written as the markup of such a node, not as a whole template. The check's own spec
 * covers the tree-level gate.
 */
describe('Unit: findUnsupportedStringEscapes', () => {
  it('finds the literal, its value, and the text left outside it', () => {
    expect(findUnsupportedStringEscapes(`"it's a \\"test\\"" | escape_javascript`)).toEqual([
      {
        index: 0,
        endIndex: 17,
        literal: `"it's a \\"`,
        value: `it's a \\`,
        outside: `test\\""`,
        intended: `"it's a \\"test\\""`,
        quote: '"',
      },
    ]);
  });

  it('finds the same mistake in a single-quoted literal', () => {
    expect(findUnsupportedStringEscapes(`'it\\'s a "test"' | escape_javascript`)).toEqual([
      {
        index: 0,
        endIndex: 16,
        literal: `'it\\'`,
        value: `it\\`,
        outside: `s a "test"'`,
        intended: `'it\\'s a "test"'`,
        quote: "'",
      },
    ]);
  });

  it('finds it in an assign value', () => {
    expect(findUnsupportedStringEscapes(`x = "a \\"b\\""`)).toEqual([
      {
        index: 4,
        endIndex: 13,
        literal: `"a \\"`,
        value: `a \\`,
        outside: `b\\""`,
        intended: `"a \\"b\\""`,
        quote: '"',
      },
    ]);
  });

  it('finds it in a filter argument, past a literal that is fine', () => {
    expect(findUnsupportedStringEscapes(`"abc" | replace: "b\\"c", "z"`)).toEqual([
      {
        index: 17,
        endIndex: 23,
        literal: `"b\\"`,
        value: `b\\`,
        outside: `c"`,
        intended: `"b\\"c"`,
        quote: '"',
      },
    ]);
  });

  it('finds it in a condition', () => {
    expect(findUnsupportedStringEscapes(`y == "a \\"b\\""`)).toEqual([
      {
        index: 5,
        endIndex: 14,
        literal: `"a \\"`,
        value: `a \\`,
        outside: `b\\""`,
        intended: `"a \\"b\\""`,
        quote: '"',
      },
    ]);
  });

  it('reports each broken literal once, and does not read the second one out of the first', () => {
    const found = findUnsupportedStringEscapes(`"a \\"b\\"" | append: "c \\"d\\""`);

    expect(found.map((escape) => escape.intended)).toEqual([`"a \\"b\\""`, `"c \\"d\\""`]);
  });

  // --- silence, each with a control above or below it that must still fire ------------------

  it('stays silent when the backslash is itself escaped and the quote legitimately closes', () => {
    // An EVEN number of backslashes is an author writing a backslash, not escaping a quote --
    // including when the markup then continues mid-token, which is the only thing separating
    // this from the mistake.
    expect(findUnsupportedStringEscapes(`"ends with a backslash \\\\" | upcase`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`"a\\\\"b`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`x = "a\\\\"b`)).toEqual([]);
  });

  it('stays silent when the literal is followed by a separator, whatever precedes its quote', () => {
    expect(findUnsupportedStringEscapes(`"a\\" | upcase`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`x = "C:\\"`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`f: "a\\", "b"`)).toEqual([]);
  });

  it('stays silent on ordinary markup, and on a backslash that escapes nothing', () => {
    expect(findUnsupportedStringEscapes(`"abc" | replace: "b", "z"`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`"a\\nb" | escape_javascript`)).toEqual([]);
    expect(findUnsupportedStringEscapes(`x | append: y`)).toEqual([]);
  });

  it('stays silent on an unterminated literal, which is a different defect', () => {
    expect(findUnsupportedStringEscapes(`"unterminated | upcase`)).toEqual([]);
  });

  it('takes the rest of the markup when the author never closed the literal they meant', () => {
    expect(findUnsupportedStringEscapes(`"a \\"b`)).toEqual([
      {
        index: 0,
        endIndex: 6,
        literal: `"a \\"`,
        value: `a \\`,
        outside: `b`,
        intended: `"a \\"b`,
        quote: '"',
      },
    ]);
  });
});
