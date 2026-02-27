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
    expect(offenses[0].message).to.equal(
      'Cannot query field "unknownField" on type "Query".',
    );
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
    expect(offenses[0].message).to.include('Syntax Error');
  });

  it('syntax error offense points to the actual error line, not the whole file', async () => {
    // unclosed brace on line 3 causes a parse error — graphql-js will report the exact location
    const query = `{
  hello
  unclosed {
`;
    const files = {
      'app/graphql/my_query.graphql': query,
    };

    const offenses = await check(files, [GraphQLCheck], mockDependencies);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('Syntax Error');
    // Offense spans exactly one line (the error line), NOT the whole file
    expect(offenses[0].start.line).to.equal(offenses[0].end.line);
    // And that line is not the last line of the file (i.e. not spanning to the end)
    expect(offenses[0].end.line).to.be.lessThan(3); // file has 4 lines (0-indexed: 0-3)
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
