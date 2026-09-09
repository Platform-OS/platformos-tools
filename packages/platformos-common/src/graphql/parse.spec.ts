import { describe, expect, it } from 'vitest';
import { isGraphqlDocument, parseGraphql } from './parse';

describe('parseGraphql', () => {
  it('parses a valid document, keeping the source verbatim', () => {
    const content = `query find($id: ID!) {
  records(filter: { table: { value: "blog_post" } }) { results { id } }
}`;

    const parsed = parseGraphql(content);

    expect(parsed.content).toEqual(content);
    expect(parsed.syntaxError).toBeUndefined();
    expect(parsed.document?.definitions.map((definition) => definition.kind)).toEqual([
      'OperationDefinition',
    ]);
  });

  it('captures a syntax error as a value, with the source and the location', () => {
    const content = 'query { records(filter: {';

    const parsed = parseGraphql(content);

    expect(parsed.content).toEqual(content);
    expect(parsed.document).toBeUndefined();
    expect(parsed.syntaxError?.message).toEqual('Syntax Error: Expected Name, found <EOF>.');
    expect(parsed.syntaxError?.locations).toEqual([{ line: 1, column: 26 }]);
  });

  it('treats an empty document as a syntax error, as the GraphQL parser does', () => {
    const parsed = parseGraphql('');

    expect(parsed.document).toBeUndefined();
    expect(parsed.syntaxError?.message).toEqual('Syntax Error: Unexpected <EOF>.');
  });

  it('never throws, whatever it is handed', () => {
    expect(() => parseGraphql('}{')).not.toThrow();
  });

  /**
   * MEASURED, not read off the GraphQL spec. graphql-js 16 parses all of these;
   * `graphql-c_parser` 1.1.3 — what the platform runs — refuses each, and the deploy fails.
   */
  describe('what graphql-js parses and the platform does not', () => {
    it.each([
      ['a query', '"""Loads one record."""\nquery find($id: ID!) { records { id } }'],
      ['a mutation', '"""Creates one."""\nmutation create { records { id } }'],
      ['a subscription', '"""Watches."""\nsubscription watch { records { id } }'],
      // A single-quoted description is the same production, and is refused the same way.
      ['a query', '"Loads one record."\nquery find { records { id } }'],
    ])('rejects a description on %s', (subject, content) => {
      const parsed = parseGraphql(content);

      expect(parsed.document).toBeUndefined();
      expect(parsed.syntaxError?.message).toEqual(
        `A description is not allowed on ${subject} — the platform rejects the file. Use a "#" comment instead.`,
      );
      expect(parsed.syntaxError?.locations).toEqual([{ line: 1, column: 1 }]);
    });

    it('rejects a description on a fragment definition', () => {
      const parsed = parseGraphql(
        '"""One record."""\nfragment F on Record { id }\nquery q { ...F }',
      );

      expect(parsed.document).toBeUndefined();
      expect(parsed.syntaxError?.message).toEqual(
        'A description is not allowed on a fragment definition — the platform rejects the file. Use a "#" comment instead.',
      );
      expect(parsed.syntaxError?.locations).toEqual([{ line: 1, column: 1 }]);
    });

    it('rejects a description on a variable definition', () => {
      const parsed = parseGraphql('query find("the id" $id: ID!) { records { id } }');

      expect(parsed.document).toBeUndefined();
      expect(parsed.syntaxError?.message).toEqual(
        'A description is not allowed on a variable definition — the platform rejects the file. Use a "#" comment instead.',
      );
      expect(parsed.syntaxError?.locations).toEqual([{ line: 1, column: 12 }]);
    });

    it('points at the definition that carries the description, not at the first one', () => {
      const parsed = parseGraphql(
        'query first { records { id } }\n"""d"""\nquery second { records { id } }',
      );

      expect(parsed.syntaxError?.locations).toEqual([{ line: 2, column: 1 }]);
    });

    /** Anywhere, not just the front: ignored by graphql-js, refused by the platform. */
    it.each([
      ['at the front', '﻿query find { records { id } }', { line: 1, column: 1 }],
      ['after a newline', '\n﻿query find { records { id } }', { line: 2, column: 1 }],
      ['after a comment', '# Loads it.\n﻿query find { records { id } }', { line: 2, column: 1 }],
      ['between definitions', 'query a { x }\n﻿query b { y }', { line: 2, column: 1 }],
      ['inside a selection set', 'query find { ﻿ records { id } }', { line: 1, column: 14 }],
      ['at the very end', 'query find { records { id } }﻿', { line: 1, column: 30 }],
    ])('rejects a byte order mark %s', (_where, content, location) => {
      const parsed = parseGraphql(content);

      expect(parsed.document).toBeUndefined();
      expect(parsed.syntaxError?.message).toEqual(
        'A byte order mark is not valid GraphQL — the platform rejects the file. Remove it and save as UTF-8 without a BOM.',
      );
      expect(parsed.syntaxError?.locations).toEqual([location]);
    });

    /**
     * The controls: a rule wide enough to catch the above is one line from refusing valid
     * input. A description on a TYPE-SYSTEM definition is legal in both grammars.
     */
    it.each([
      ['a description on a type-system definition', '"""A record."""\ntype Record { id: ID! }'],
      ['a "#" comment above an operation', '# Loads one record.\nquery find { records { id } }'],
      ['an undescribed operation', 'query find($id: ID!) { records { id } }'],
      ['an undescribed variable definition', 'query find($id: ID!) { records(id: $id) { id } }'],
    ])('still accepts %s', (_subject, content) => {
      const parsed = parseGraphql(content);

      expect(parsed.syntaxError).toBeUndefined();
      expect(parsed.document).toBeDefined();
    });
  });

  describe('isGraphqlDocument', () => {
    it('accepts a parsed document, valid or not', () => {
      expect(isGraphqlDocument(parseGraphql('query { records { results { id } } }'))).toBe(true);
      expect(isGraphqlDocument(parseGraphql('query {'))).toBe(true);
    });

    it('rejects the other things an `AppFile.ast` can hold', () => {
      expect(isGraphqlDocument(new Error('unreadable'))).toBe(false);
      expect(isGraphqlDocument({ type: 'LiquidTag' })).toBe(false);
      expect(isGraphqlDocument(undefined)).toBe(false);
      expect(isGraphqlDocument(null)).toBe(false);
      expect(isGraphqlDocument('query { x }')).toBe(false);
    });
  });
});
