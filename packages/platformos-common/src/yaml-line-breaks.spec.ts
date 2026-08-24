import { describe, expect, it } from 'vitest';

import { normalizeLoneCarriageReturns } from './yaml-line-breaks';

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
