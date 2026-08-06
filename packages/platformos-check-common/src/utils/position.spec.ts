import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { getOffset, getPosition } from './position';

/**
 * `getPosition` is the only producer of `Offense.start` / `Offense.end`, and the
 * language server copies those into LSP `Range`s without converting them. So the
 * property worth asserting is not "the numbers look right" but "we agree with the
 * LSP's own document model, everywhere".
 *
 * The oracle is `TextDocument` from `vscode-languageserver-textdocument` — the
 * implementation VS Code and the language server themselves use. Checking against it
 * rather than against hand-written expectations is the difference between pinning the
 * behaviour and pinning my reading of the specification. The hand-written tables
 * further down are kept anyway, for the two cases that motivated this file: they say
 * what changed in terms a reader can check without running anything.
 */

/** Every offset a source has, including the one PAST its last character. */
const everyOffset = (source: string): number[] =>
  Array.from({ length: source.length + 1 }, (_, index) => index);

const ours = (source: string) =>
  everyOffset(source).map((index) => {
    const { line, character } = getPosition(source, index);
    return { line, character };
  });

const theirs = (source: string) => {
  const document = TextDocument.create('file:///a.liquid', 'liquid', 0, source);
  return everyOffset(source).map((index) => {
    const { line, character } = document.positionAt(index);
    return { line, character };
  });
};

const SOURCES: Record<string, string> = {
  empty: '',
  'no terminator at all': 'a: 1',
  'LF, trailing': `a: 1
b: 2
`,
  'LF, no trailing': `a: 1
b: 2`,
  'CRLF, trailing': 'a: 1\r\nb: 2\r\n',
  'CRLF, no trailing': 'a: 1\r\nb: 2',
  'lone CR (classic Mac)': 'a: 1\rb: 2\r',
  'mixed CRLF and LF': 'a: 1\r\nb: 2\nc: 3\r\n',
  'consecutive blank lines': `a


b`,
  'consecutive blank CRLF lines': 'a\r\n\r\n\r\nb',
  'terminator only': '\n',
  'CRLF terminator only': '\r\n',
  'CR then LF as separate lines': '\n\r',
  'leading BOM': '﻿a: 1\n',
  'astral plane characters': `a: "😀😀"
b: 2
`,
  'combining marks': `a: "éé"
b: 2
`,
  'trailing whitespace before CRLF': 'a: 1   \r\n',
};

describe('Unit: getPosition', () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    it(`agrees with the LSP document model at every offset — ${name}`, () => {
      expect(ours(source)).toEqual(theirs(source));
    });
  }

  it('reports the CRLF line terminator inside the line, not one past its end', () => {
    // The defect this file was written for. `{{ x ` is five characters, so the only
    // valid columns are 0..5 — column 5 being the end-of-line insertion point. The
    // previous implementation counted the carriage return as a sixth character and
    // reported the `\n` at column 6, a column the line does not have. Under LF the
    // same construct always reported 5, which is why LF and CRLF now agree.
    // Both stay ESCAPED. The space before the terminator is the fifth character and
    // therefore load-bearing; a template literal would put it at the end of a source
    // line, where any editor that trims trailing whitespace silently rewrites the
    // fixture into a different one.
    const crlf = '{{ x \r\n{{ y';
    const lf = '{{ x \n{{ y';

    expect({
      crlfAtCarriageReturn: getPosition(crlf, 5),
      crlfAtLineFeed: getPosition(crlf, 6),
      lfAtLineFeed: getPosition(lf, 5),
    }).toEqual({
      crlfAtCarriageReturn: { index: 5, line: 0, character: 5 },
      crlfAtLineFeed: { index: 6, line: 0, character: 5 },
      lfAtLineFeed: { index: 5, line: 0, character: 5 },
    });
  });

  it('places an end-of-input offset after the source, not on its last character', () => {
    // `yaml` reports `[length, length + 1]` for every unterminated construct, so this
    // is the position of a real, common diagnostic and not a synthetic edge case.
    // With a trailing terminator the position is the empty last line an editor shows.
    const withTrailingNewline = 'a: "unterminated\n';
    const withoutTrailingNewline = 'a: "x';

    expect({
      afterTrailingNewline: getPosition(withTrailingNewline, withTrailingNewline.length),
      atEndOfLastLine: getPosition(withoutTrailingNewline, withoutTrailingNewline.length),
    }).toEqual({
      afterTrailingNewline: { index: 17, line: 1, character: 0 },
      atEndOfLastLine: { index: 5, line: 0, character: 5 },
    });
  });

  it('gives an empty source a real position rather than -1, -1', () => {
    // `line-column`'s `fromIndex(-1)` is null, and the old end-of-input workaround
    // produced exactly that index for an empty file.
    expect(getPosition('', 0)).toEqual({ index: 0, line: 0, character: 0 });
  });

  it('returns the caller index verbatim, even when it is out of range', () => {
    // `Offense.start.index` is what `disabled-checks` and the code-action providers
    // slice the source with. Only the line/character projection is clamped.
    const source = 'a: 1\n';

    expect([getPosition(source, -3), getPosition(source, 99)]).toEqual([
      { index: -3, line: 0, character: 0 },
      { index: 99, line: 1, character: 0 },
    ]);
  });

  it('counts characters in UTF-16 code units, so an astral character advances by two', () => {
    const source = '😀x';

    expect([getPosition(source, 0), getPosition(source, 2)]).toEqual([
      { index: 0, line: 0, character: 0 },
      { index: 2, line: 0, character: 2 },
    ]);
  });

  it('stays correct when sources are interleaved, so the line-start memo cannot go stale', () => {
    // The memo is keyed on string identity and rebuilt on a miss. Alternating between
    // two shapes with DIFFERENT line structure is what a stale entry would break.
    const short = `a
b`;
    const long = 'aaaa\r\nbbbb\r\ncccc';

    expect([
      getPosition(short, 2),
      getPosition(long, 12),
      getPosition(short, 2),
      getPosition(long, 12),
    ]).toEqual([
      { index: 2, line: 1, character: 0 },
      { index: 12, line: 2, character: 0 },
      { index: 2, line: 1, character: 0 },
      { index: 12, line: 2, character: 0 },
    ]);
  });
});

describe('Unit: getOffset', () => {
  it('reads 1-based line and column, matching the parser that produces them', () => {
    // Kept deliberately separate from `getPosition`: this speaks the parser's
    // convention, not the LSP's, and the two must not be assumed to be inverses.
    const source = `a: 1
bb: 2
`;

    expect([getOffset(source, 1, 1), getOffset(source, 2, 1), getOffset(source, 2, 3)]).toEqual([
      0, 5, 7,
    ]);
  });
});
