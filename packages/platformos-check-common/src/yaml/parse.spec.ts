import { describe, expect, it } from 'vitest';

import { YAMLConvertError, toYAMLNode } from './parse';

/**
 * The FAILURE contract, pinned at the layer that owns it.
 *
 * `YAMLSyntaxError` reads these values and turns them into offenses, so its spec
 * proves the two ends agree. What it cannot show is the shape in between — and this
 * layer used to have none: the parse error was reduced to a message string, and the
 * offsets the parser had already computed were dropped. Anything wanting a line and
 * column had to parse English back out of the message.
 *
 * Three properties are worth holding here rather than through a check, because each
 * is a decision about the parser rather than about reporting: which errors are the
 * FILE's fault, that offsets address real positions, and that recovery is preserved.
 */
describe('Unit: toYAMLNode failure contract', () => {
  /** The failures a source produces, or `null` if it parsed. */
  const failuresFor = (source: string) => {
    try {
      toYAMLNode(source);
      return null;
    } catch (error) {
      if (error instanceof YAMLConvertError) return error.failures;
      throw error;
    }
  };

  it('carries the parser message with no location suffix or snippet', () => {
    // `prettyErrors: false`. With the default the library appends ` at line N,
    // column M:` and a source excerpt, and the only way back to a clean sentence is
    // a regex over English — while the position is already available structurally.
    expect(failuresFor('a:\n\tb: 1\n')).toEqual([
      { message: 'Tabs are not allowed as indentation', offset: 3, length: 1 },
    ]);
  });

  it('reports every failure the parser recovered from, in source order', () => {
    const failures = failuresFor('en:\n  hello: [unclosed\n   bad: : :\n') ?? [];

    // Taking `errors[0]` was the previous behaviour, and it hides genuinely
    // independent problems in a document the parser kept reading.
    expect(failures.length).toBeGreaterThan(1);
    expect(failures.map((failure) => failure.offset)).toEqual(
      [...failures.map((failure) => failure.offset)].sort((a, b) => a - b),
    );
  });

  it('never points past the end of the source', () => {
    // `yaml` reports one PAST the last character for an unterminated construct. An
    // unclamped range would address a position the file does not have.
    const source = 'name: "oops\n';
    const failures = failuresFor(source) ?? [];

    expect(failures.every(({ offset, length }) => offset + length <= source.length)).toBe(true);
    // Offset 12 IS the source length: the failure is at end of input, and the clamp
    // keeps it addressable rather than running past.
    expect(failures).toEqual([{ message: 'Missing closing "quote', offset: 12, length: 0 }]);
  });

  it('does NOT treat a multi-document file as a failure', () => {
    // `MULTIPLE_DOCS` is the parser objecting to being asked for one document, not
    // the author making a mistake — multi-document YAML is valid YAML, and the first
    // document still parses. Reporting it would put a false BLOCK on every such file
    // for a reason no author could act on except by restructuring valid input.
    expect(failuresFor('name: a\n---\nname: b\n')).toEqual(null);
  });

  it('still reports a real failure in the first document of a multi-document file', () => {
    // Dropping `MULTIPLE_DOCS` must not drop everything alongside it.
    expect(failuresFor('name: [a\n---\nname: b\n')).toEqual([
      {
        message: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
        offset: 9,
        length: 1,
      },
    ]);
  });

  it('parses the shapes a project actually contains', () => {
    // Including the two that look degenerate: an empty file and a comment-only file
    // are both common and both valid.
    for (const source of [
      'name: car\nproperties:\n  - name: make\n    type: string\n',
      'en:\n  hello: Hello\n',
      '',
      '# nothing here\n',
      'a: 1\n...\n',
    ]) {
      expect(failuresFor(source)).toEqual(null);
    }
  });
});
