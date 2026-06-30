import { describe, expect, it } from 'vitest';
import { extractGraphqlTable } from './graphql-table';

describe('extractGraphqlTable', () => {
  it('extracts the table from a `table: { value: "..." }` filter', () => {
    const content = `query find($id: ID!) {
  records(per_page: 1, filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTable(content)).toBe('blog_post');
  });

  it('extracts the table from the `table: "..."` shorthand', () => {
    const content = `query { records(filter: { table: "product" }) { results { id } } }`;
    expect(extractGraphqlTable(content)).toBe('product');
  });

  it('returns the first table when several are present', () => {
    const content = `query {
  a: records(filter: { table: { value: "first" } }) { results { id } }
  b: records(filter: { table: { value: "second" } }) { results { id } }
}`;
    expect(extractGraphqlTable(content)).toBe('first');
  });

  it('returns undefined when there is no table filter', () => {
    const content = `query currentUser { current_user { id email } }`;
    expect(extractGraphqlTable(content)).toBeUndefined();
  });

  it('is not confused by a sibling `value` field on a non-table object', () => {
    const content = `query find($id: ID!) {
  records(filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTable(content)).toBe('blog_post');
  });

  it('returns undefined for unparseable GraphQL', () => {
    expect(extractGraphqlTable('query { records(filter: {')).toBeUndefined();
  });

  it('returns undefined for an empty document', () => {
    expect(extractGraphqlTable('')).toBeUndefined();
  });

  it('extracts the table from a mutation (records_create style)', () => {
    const content = `mutation create($payload: HashObject) {
  record_create(record: { table: "blog_post", properties: $payload }) {
    id
  }
}`;
    expect(extractGraphqlTable(content)).toBe('blog_post');
  });

  it('extracts a table nested deep inside the filter object', () => {
    const content = `query {
  records(filter: { properties: { name: { value: "x" } }, table: { value: "comment" } }) {
    results { id }
  }
}`;
    expect(extractGraphqlTable(content)).toBe('comment');
  });

  it('extracts the table when it appears before other fields (order-independent)', () => {
    const content = `query { records(filter: { table: { value: "tag" }, deleted: { exists: false } }) { results { id } } }`;
    expect(extractGraphqlTable(content)).toBe('tag');
  });

  it('handles an underscored/namespaced table name', () => {
    const content = `query { records(filter: { table: { value: "modules/core/user" } }) { results { id } } }`;
    expect(extractGraphqlTable(content)).toBe('modules/core/user');
  });

  it('returns undefined when `table` is a non-string (dynamic) value', () => {
    const content = `query q($t: String) { records(filter: { table: { value: $t } }) { results { id } } }`;
    expect(extractGraphqlTable(content)).toBeUndefined();
  });

  it('ignores a `table` used as a GraphQL alias, not a filter field', () => {
    // `table:` here is a field alias (table: results), not an object field.
    const content = `query { records(filter: { deleted: { exists: false } }) { table: results { id } } }`;
    expect(extractGraphqlTable(content)).toBeUndefined();
  });
});
