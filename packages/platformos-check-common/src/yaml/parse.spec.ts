import { describe, expect, it } from 'vitest';

import { YAMLConvertError, toYAMLNode } from './parse';
import type { LiteralNode, ObjectNode } from '../jsonc/types';

/**
 * The FAILURE contract, pinned at the layer that owns it.
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
    const failures =
      failuresFor(`en:
  hello: [unclosed
   bad: : :
`) ?? [];

    // Taking `errors[0]` was the previous behaviour, and it hides genuinely
    // independent problems in a document the parser kept reading.
    expect(failures.length).toBeGreaterThan(1);
    expect(failures.map((failure) => failure.offset)).toEqual(
      [...failures.map((failure) => failure.offset)].sort((a, b) => a - b),
    );
  });

  it('never points past the end of the source, for any unterminated construct', () => {
    // `yaml` reports `[length, length + 1]` whenever input runs out mid-construct.
    // `length` is a real position — end of input, which `getPosition` places on the
    // empty last line — so only the `+ 1` is clamped away, leaving an empty range.
    const sources = [
      'name: "oops\n',
      'name: "oops',
      'name: [1, 2\n',
      'name: [1, 2',
      'name: {a: 1\n',
      'name: {a: 1',
    ];

    expect(
      sources.map((source) =>
        (failuresFor(source) ?? []).map(({ offset, length }) => [offset, length]),
      ),
    ).toEqual(sources.map((source) => [[source.length, 0]]));
  });

  it('does NOT treat a multi-document file as a failure', () => {
    // `MULTIPLE_DOCS` is the parser objecting to being asked for one document, not
    // the author making a mistake — multi-document YAML is valid YAML, and the first
    // document still parses. Reporting it would put a false BLOCK on every such file
    // for a reason no author could act on except by restructuring valid input.
    expect(
      failuresFor(`name: a
---
name: b
`),
    ).toEqual(null);
  });

  it('still reports a real failure in the first document of a multi-document file', () => {
    // Dropping `MULTIPLE_DOCS` must not drop everything alongside it.
    expect(
      failuresFor(`name: [a
---
name: b
`),
    ).toEqual([
      {
        message: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
        offset: 9,
        length: 1,
      },
    ]);
  });

  it('does NOT treat a repeated key as a failure', () => {
    // `uniqueKeys: false`. The library defaults it to `true` and raises
    // `DUPLICATE_KEY`, which reached the blocking gate — while the converter accepts
    // a repeated key and resolves it last-wins.
    expect(
      failuresFor(`a: 1
a: 2
`),
    ).toEqual(null);
    expect(
      failuresFor(`top:
  a: 1
  a: 2
`),
    ).toEqual(null);
  });

  it('keeps BOTH pairs of a repeated key in the node tree', () => {
    // Not cosmetic: suppressing the error must not also drop data. Every property
    // survives, in source order, so a check walking the tree sees exactly what the
    // author wrote — and a reader resolving to a single value takes the last, which
    // is what the platform does.
    const node = toYAMLNode(`a: 1
a: 2
`) as ObjectNode;

    expect(
      node.children.map((property) => [property.key.value, (property.value as LiteralNode).value]),
    ).toEqual([
      ['a', 1],
      ['a', 2],
    ]);
  });

  it('parses the shapes a project actually contains', () => {
    // Including the two that look degenerate: an empty file and a comment-only file
    // are both common and both valid.
    for (const source of [
      `name: car
properties:
  - name: make
    type: string
`,
      `en:
  hello: Hello
`,
      '',
      '# nothing here\n',
      `a: 1
...
`,
    ]) {
      expect(failuresFor(source)).toEqual(null);
    }
  });
});
