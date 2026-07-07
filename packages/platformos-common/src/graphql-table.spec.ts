import { describe, expect, it } from 'vitest';
import { extractGraphqlTables } from './graphql-table';

describe('extractGraphqlTables', () => {
  it('extracts the table from a `table: { value: "..." }` filter', () => {
    const content = `query find($id: ID!) {
  records(per_page: 1, filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTables(content)).toEqual(['blog_post']);
  });

  it('extracts the table from the `table: "..."` shorthand', () => {
    const content = `query { records(filter: { table: "product" }) { results { id } } }`;
    expect(extractGraphqlTables(content)).toEqual(['product']);
  });

  it('returns every distinct table when several are present, in document order', () => {
    const content = `query {
  a: records(filter: { table: { value: "first" } }) { results { id } }
  b: records(filter: { table: { value: "second" } }) { results { id } }
}`;
    expect(extractGraphqlTables(content)).toEqual(['first', 'second']);
  });

  it('deduplicates a table declared more than once', () => {
    const content = `query {
  a: records(filter: { table: { value: "blog_post" } }) { results { id } }
  b: records(filter: { table: { value: "blog_post" } }) { results { id } }
}`;
    expect(extractGraphqlTables(content)).toEqual(['blog_post']);
  });

  it('returns an empty array when there is no table filter', () => {
    const content = `query currentUser { current_user { id email } }`;
    expect(extractGraphqlTables(content)).toEqual([]);
  });

  it('is not confused by a sibling `value` field on a non-table object', () => {
    const content = `query find($id: ID!) {
  records(filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTables(content)).toEqual(['blog_post']);
  });

  it('returns an empty array for unparseable GraphQL', () => {
    expect(extractGraphqlTables('query { records(filter: {')).toEqual([]);
  });

  it('returns an empty array for an empty document', () => {
    expect(extractGraphqlTables('')).toEqual([]);
  });

  it('extracts the table from a mutation (record_create style)', () => {
    const content = `mutation create($payload: HashObject) {
  record_create(record: { table: "blog_post", properties: $payload }) {
    id
  }
}`;
    expect(extractGraphqlTables(content)).toEqual(['blog_post']);
  });

  it('extracts every table across a mixed query + record_create mutation, in document order', () => {
    const content = `mutation seed($payload: HashObject) {
  comment: record_create(record: { table: "comment", properties: $payload }) { id }
  existing: records(filter: { table: { value: "blog_post" } }) { results { id } }
}`;
    expect(extractGraphqlTables(content)).toEqual(['comment', 'blog_post']);
  });

  it('extracts a table nested deep inside the filter object', () => {
    const content = `query {
  records(filter: { properties: { name: { value: "x" } }, table: { value: "comment" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTables(content)).toEqual(['comment']);
  });

  it('extracts the table when it appears before other fields (order-independent)', () => {
    const content = `query { records(filter: { table: { value: "tag" }, deleted: { exists: false } }) { results { id } } }`;
    expect(extractGraphqlTables(content)).toEqual(['tag']);
  });

  it('handles an underscored/namespaced table name', () => {
    const content = `query { records(filter: { table: { value: "modules/core/user" } }) { results { id } } }`;
    expect(extractGraphqlTables(content)).toEqual(['modules/core/user']);
  });

  it('ignores a non-string (dynamic) table value', () => {
    const content = `query q($t: String) { records(filter: { table: { value: $t } }) { results { id } } }`;
    expect(extractGraphqlTables(content)).toEqual([]);
  });

  it('ignores a `table` used as a GraphQL alias, not a filter field', () => {
    // `table:` here is a field alias (table: results), not an object field.
    const content = `query { records(filter: { deleted: { exists: false } }) { table: results { id } } }`;
    expect(extractGraphqlTables(content)).toEqual([]);
  });
});
