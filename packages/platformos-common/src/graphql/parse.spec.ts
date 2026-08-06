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
