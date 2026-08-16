import { describe, expect, it } from 'vitest';

import { normalizeLoneCarriageReturns } from './line-breaks';
import { toYAMLNode, YAMLConvertError } from './parse';
import { getPosition } from '../utils/position';

/**
 * A lone `\r` is a line break to the platform (Psych/libyaml, YAML 1.1) and not to this
 * package's parser (npm `yaml`, YAML 1.2). That disagreement was a FALSE BLOCK.
 */
describe('Unit: normalizeLoneCarriageReturns', () => {
  it('leaves a source with no carriage return exactly as it was', async () => {
    const source = `a: 1
b: 2
`;

    // Same reference, not merely equal: this runs on every YAML file in a project and
    // the common case must not allocate.
    expect(normalizeLoneCarriageReturns(source)).toBe(source);
  });

  it('converts a lone carriage return, and leaves CRLF alone', async () => {
    expect([
      normalizeLoneCarriageReturns('a: 1\rb: 2\n'),
      normalizeLoneCarriageReturns('a: 1\r\nb: 2\r\n'),
      // Mixed in one file — the CRLF survives, the lone CR does not.
      normalizeLoneCarriageReturns('a: 1\r\nb: 2\rc: 3\n'),
      normalizeLoneCarriageReturns('en:\r  key: hello\r'),
    ]).toEqual([
      `a: 1
b: 2
`,
      'a: 1\r\nb: 2\r\n',
      'a: 1\r\nb: 2\nc: 3\n',
      `en:
  key: hello
`,
    ]);
  });

  it('never changes the length, which is what keeps every diagnostic offset valid', async () => {
    // THE PROPERTY THE WHOLE APPROACH RESTS ON. Offsets are computed against the
    // caller's ORIGINAL source, so a normalization that inserted or removed a byte
    // would silently shift every position in the file. One byte for one byte.
    const sources = [
      'a: 1\rb: 2\n',
      'a: 1\r\nb: 2\rc: 3\n',
      '\r\r\r',
      'en:\r  key: hello\r',
      `a: 1
b: 2
`,
    ];

    expect(sources.map((source) => normalizeLoneCarriageReturns(source).length)).toEqual(
      sources.map((source) => source.length),
    );
  });
});

describe('Integration: YAML with a lone carriage return parses, as it deploys', () => {
  const parsed = (source: string) => {
    try {
      return toYAMLNode(source);
    } catch (error) {
      return error as YAMLConvertError;
    }
  };

  it('parses a stray CR in an otherwise normal LF file', async () => {
    // The shape that matters. Not an exotic encoding — a paste artefact.
    const node = parsed('a: 1\rb: 2\n');

    expect(node instanceof YAMLConvertError).toBe(false);
  });

  it('parses a classic-Mac file, every line ended with CR', async () => {
    expect(parsed('en:\r  key: hello\r') instanceof YAMLConvertError).toBe(false);
  });

  it('still reports a GENUINE syntax error in a file that also has a lone CR', async () => {
    // The control. A normalization wide enough to hide real parse failures would pass
    // every assertion above, so the suppression is bounded here.
    const failure = parsed('a: 1\rb: [unclosed\n');

    expect(failure instanceof YAMLConvertError).toBe(true);
  });

  it('reports that error at an offset into the ORIGINAL source', async () => {
    // THE OFFSET-PRESERVATION PROOF, and the fixture is chosen deliberately.
    const source = 'a: 1\rb:\r\tc: 1\n';
    const failure = parsed(source) as YAMLConvertError;
    const { offset } = failure.failures[0];

    expect({
      isError: failure instanceof YAMLConvertError,
      offset,
      // The character AT that offset in the caller's own string is the tab that caused
      // it — the strongest available statement that the offset was not shifted.
      char: source[offset],
      // `getPosition` treats a lone CR as a terminator too, so this agrees with the
      // parser about which line that is.
      position: getPosition(source, offset),
    }).toEqual({
      isError: true,
      offset: 8,
      char: '\t',
      position: { index: 8, line: 2, character: 0 },
    });
  });
});
