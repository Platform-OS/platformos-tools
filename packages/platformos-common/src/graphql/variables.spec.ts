import { describe, expect, it } from 'vitest';
import { parseGraphql } from './parse';
import { extractGraphqlVariables } from './variables';

const variablesOf = (content: string) => extractGraphqlVariables(parseGraphql(content));

describe('extractGraphqlVariables', () => {
  it('reports a non-null variable with no default as required', () => {
    expect(variablesOf('query find($id: ID!) { records { results { id } } }')).toEqual([
      { name: 'id', required: true },
    ]);
  });

  it('reports a nullable variable as optional', () => {
    expect(variablesOf('query find($id: ID) { records { results { id } } }')).toEqual([
      { name: 'id', required: false },
    ]);
  });

  it('reports a non-null variable WITH a default as optional — the default supplies it', () => {
    expect(variablesOf('query find($id: ID! = "1") { records { results { id } } }')).toEqual([
      { name: 'id', required: false },
    ]);
  });

  it('returns every variable of every operation, in declaration order', () => {
    const content = `query find($id: ID!, $limit: Int) { records { results { id } } }
mutation create($payload: HashObject!) { record_create(record: { table: "x" }) { id } }`;

    expect(variablesOf(content)).toEqual([
      { name: 'id', required: true },
      { name: 'limit', required: false },
      { name: 'payload', required: true },
    ]);
  });

  it('returns an empty list for an operation that declares no variables', () => {
    expect(variablesOf('query { records { results { id } } }')).toEqual([]);
  });

  it('ignores a fragment definition, which declares no variables', () => {
    const content = `fragment fields on Record { id }
query find($id: ID!) { records { results { ...fields } } }`;

    expect(variablesOf(content)).toEqual([{ name: 'id', required: true }]);
  });

  // An empty list says "this operation takes nothing", which makes every argument at
  // the call site wrong. A document we could not read says nothing at all, and a
  // caller must report nothing — hence `undefined` rather than `[]`.
  it('returns undefined — not an empty list — for a document that does not parse', () => {
    expect(variablesOf('query find($id: ID!) {')).toBeUndefined();
    expect(variablesOf('')).toBeUndefined();
  });
});
