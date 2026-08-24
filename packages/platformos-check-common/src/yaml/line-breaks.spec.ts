import { describe, expect, it } from 'vitest';

import { toYAMLNode, YAMLConvertError } from './parse';
import { getPosition } from '../utils/position';

/**
 * `normalizeLoneCarriageReturns` itself lives in `platformos-common` and is unit-tested
 * there. What is proved HERE is the half that needs this package's parser: that a source
 * the platform accepts still parses, and that the offsets it reports index the caller's
 * ORIGINAL string.
 */
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
