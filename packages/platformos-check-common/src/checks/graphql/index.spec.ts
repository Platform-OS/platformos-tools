import { expect, describe, it } from 'vitest';
import { GraphQLCheck, lineToRange } from './index';
import { check } from '../../test';

const SCHEMA = `
  type Query {
    hello: String
    users: [User]
  }

  type User {
    id: ID
    name: String
  }
`;

const mockDependencies = {
  platformosDocset: {
    async graphQL() {
      return SCHEMA;
    },
    async filters() {
      return [];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async tags() {
      return [];
    },
  },
};

const noDeps = {
  platformosDocset: {
    async graphQL() {
      return null;
    },
    async filters() {
      return [];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async tags() {
      return [];
    },
  },
};

describe('Module: GraphQLCheck', () => {
  it('reports no offenses for a valid query', async () => {
    const files = {
      'app/graphql/my_query.graphql': '{ hello }',
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);
    expect(offenses).to.be.empty;
  });

  it('reports an offense for an unknown field', async () => {
    const files = {
      'app/graphql/my_query.graphql': '{ unknownField }',
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('Cannot query field "unknownField" on type "Query".');
  });

  it('offense for unknown field spans only the affected line, not the entire file', async () => {
    const query = `{
  unknownField
}`;
    const files = {
      'app/graphql/my_query.graphql': query,
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);
    expect(offenses).to.have.length(1);

    // Should point to line 2 (1-based), which is "  unknownField"
    // and NOT span to the end of the file
    expect(offenses[0].start.line).to.equal(1); // 0-based: line index 1 = "  unknownField"
    expect(offenses[0].end.line).to.equal(1);
  });

  it('reports a syntax error offense instead of swallowing it', async () => {
    const files = {
      'app/graphql/my_query.graphql': '{ unclosed {',
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('Syntax Error: Expected Name, found <EOF>.');
  });

  it('syntax error offense points to the actual error line, not the whole file', async () => {
    // An unclosed brace leaves graphql-js reporting `<EOF>`, which it locates on line
    // 4 — the empty line the trailing newline opens. That is genuinely where the
    // error is, so the offense sits at line 3 (0-based), character 0.
    //
    // This used to assert `end.line < 3`, and passed only because `getPosition`
    // collapsed an end-of-input offset onto the last CHARACTER, reporting the error a
    // line early. The intent behind that assertion — the offense must not span the
    // whole file — is better served by pinning the range outright: a whole-file range
    // would be 0,0 to 3,0 and this fails on it.
    const query = `{
  hello
  unclosed {
`;
    const files = {
      'app/graphql/my_query.graphql': query,
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);

    expect(
      offenses.map((offense) => ({
        check: offense.check,
        message: offense.message,
        start: { line: offense.start.line, character: offense.start.character },
        end: { line: offense.end.line, character: offense.end.character },
      })),
    ).toEqual([
      {
        check: 'GraphQLCheck',
        message: 'Syntax Error: Expected Name, found <EOF>.',
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
      },
    ]);
  });

  it('reports no offenses when platformosDocset.graphQL returns null', async () => {
    const files = {
      'app/graphql/my_query.graphql': '{ unknownField }',
    };

    const offenses = await check(files, [GraphQLCheck], noDeps);
    expect(offenses).to.be.empty;
  });
});

describe('Unit: lineToRange', () => {
  const TEXT = 'line1\nline2\nline3';

  it('returns correct range for line 1', () => {
    expect(lineToRange(TEXT, 1)).to.eql([0, 5]); // "line1"
  });

  it('returns correct range for line 2', () => {
    expect(lineToRange(TEXT, 2)).to.eql([6, 11]); // "line2"
  });

  it('returns correct range for line 3', () => {
    expect(lineToRange(TEXT, 3)).to.eql([12, 17]); // "line3"
  });

  it('clamps line 0 to first line instead of spanning the whole file', () => {
    const [start, end] = lineToRange(TEXT, 0);
    expect(start).to.equal(0);
    expect(end).to.equal(5); // "line1" length = 5, not TEXT.length (17)
  });

  it('clamps line beyond last to last line instead of spanning the whole file', () => {
    const [start, end] = lineToRange(TEXT, 999);
    expect(start).to.equal(12);
    expect(end).to.equal(17); // "line3"
  });

  it('handles single-line text with line 0', () => {
    const [start, end] = lineToRange('hello', 0);
    expect(start).to.equal(0);
    expect(end).to.equal(5); // entire single line, NOT text.length (which happens to be the same here)
  });

  it('does not return the whole file when line is 0', () => {
    const longText = 'first line\nsecond line\nthird line';
    const [, end] = lineToRange(longText, 0);
    // Should be end of first line (10), not end of whole text (33)
    expect(end).to.equal(10);
    expect(end).to.not.equal(longText.length);
  });
});
