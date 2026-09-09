import { describe, expect, it } from 'vitest';
import { parseGraphql } from './parse';
import { extractGraphqlTables } from './tables';

/** The two steps a real caller takes, except that a real caller parses once per file. */
const tablesOf = (content: string) => extractGraphqlTables(parseGraphql(content));

describe('extractGraphqlTables', () => {
  it('extracts the table from a `table: { value: "..." }` filter', () => {
    const content = `query find($id: ID!) {
  records(per_page: 1, filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(tablesOf(content)).toEqual(['blog_post']);
  });

  it('extracts the table from the `table: "..."` shorthand', () => {
    const content = `query { records(filter: { table: "item" }) { results { id } } }`;
    expect(tablesOf(content)).toEqual(['item']);
  });

  it('returns every distinct table when several are present, in document order', () => {
    const content = `query {
  a: records(filter: { table: { value: "first" } }) { results { id } }
  b: records(filter: { table: { value: "second" } }) { results { id } }
}`;
    expect(tablesOf(content)).toEqual(['first', 'second']);
  });

  it('deduplicates a table declared more than once', () => {
    const content = `query {
  a: records(filter: { table: { value: "blog_post" } }) { results { id } }
  b: records(filter: { table: { value: "blog_post" } }) { results { id } }
}`;
    expect(tablesOf(content)).toEqual(['blog_post']);
  });

  it('returns an empty array when there is no table filter', () => {
    const content = `query currentUser { current_user { id email } }`;
    expect(tablesOf(content)).toEqual([]);
  });

  it('is not confused by a sibling `value` field on a non-table object', () => {
    const content = `query find($id: ID!) {
  records(filter: { id: { value: $id }, table: { value: "blog_post" } }) {
    results { id }
  }
}`;
    expect(tablesOf(content)).toEqual(['blog_post']);
  });

  it('returns an empty array for unparseable GraphQL', () => {
    expect(tablesOf('query { records(filter: {')).toEqual([]);
  });

  it('returns an empty array for an empty document', () => {
    expect(tablesOf('')).toEqual([]);
  });

  it('extracts the table from a mutation (record_create style)', () => {
    const content = `mutation create($payload: HashObject) {
  record_create(record: { table: "blog_post", properties: $payload }) {
    id
  }
}`;
    expect(tablesOf(content)).toEqual(['blog_post']);
  });

  it('extracts every table across a mixed query + record_create mutation, in document order', () => {
    const content = `mutation seed($payload: HashObject) {
  comment: record_create(record: { table: "comment", properties: $payload }) { id }
  existing: records(filter: { table: { value: "blog_post" } }) { results { id } }
}`;
    expect(tablesOf(content)).toEqual(['comment', 'blog_post']);
  });

  it('extracts a table nested deep inside the filter object', () => {
    const content = `query {
  records(filter: { properties: { name: { value: "x" } }, table: { value: "comment" } }) {
    results { id }
  }
}`;
    expect(tablesOf(content)).toEqual(['comment']);
  });

  it('extracts the table when it appears before other fields (order-independent)', () => {
    const content = `query { records(filter: { table: { value: "tag" }, deleted: { exists: false } }) { results { id } } }`;
    expect(tablesOf(content)).toEqual(['tag']);
  });

  it('handles an underscored/namespaced table name', () => {
    const content = `query { records(filter: { table: { value: "modules/core/user" } }) { results { id } } }`;
    expect(tablesOf(content)).toEqual(['modules/core/user']);
  });

  it('ignores a non-string (dynamic) table value', () => {
    const content = `query q($t: String) { records(filter: { table: { value: $t } }) { results { id } } }`;
    expect(tablesOf(content)).toEqual([]);
  });

  it('ignores a `table` used as a GraphQL alias, not a filter field', () => {
    // `table:` here is a field alias (table: results), not an object field.
    const content = `query { records(filter: { deleted: { exists: false } }) { table: results { id } } }`;
    expect(tablesOf(content)).toEqual([]);
  });

  it('reads the document it is given, so one parse serves every consumer', () => {
    const parsed = parseGraphql(
      `query { records(filter: { table: { value: "blog_post" } }) { results { id } } }`,
    );

    expect(extractGraphqlTables(parsed)).toEqual(['blog_post']);
    expect(extractGraphqlTables(parsed)).toEqual(['blog_post']);
  });

  // The four mutations are taken from a live introspection of the root mutation type.
  describe('a table named by the argument itself', () => {
    it.each([
      ['record_delete', 'mutation { record_delete(id: 1, table: "blog_post") { id } }'],
      ['records_delete_all', 'mutation { records_delete_all(table: "blog_post") { id } }'],
      [
        'records_update_all',
        'mutation { records_update_all(table: "blog_post", record: {}) { id } }',
      ],
      [
        'property_upload_presigned_url',
        'mutation { property_upload_presigned_url(property_name: "p", table: "blog_post") { url } }',
      ],
    ])('extracts the table %s passes as an argument', (_field, content) => {
      expect(tablesOf(content)).toEqual(['blog_post']);
    });

    it('ignores a dynamic table argument, as it does a dynamic filter value', () => {
      expect(tablesOf('mutation m($t: String) { record_delete(id: 1, table: $t) { id } }')).toEqual(
        [],
      );
    });
  });

  // `endpoint` is non-null on every remote field, so it marks them without a list of names.
  describe('a table belonging to another instance', () => {
    it('does not extract a table under a field carrying an endpoint argument', () => {
      const content = `query {
  remote_records(per_page: 1, endpoint: { url: "https://other" }, filter: { table: { value: "remote_tbl" } }) {
    results { id }
  }
}`;
      expect(tablesOf(content)).toEqual([]);
    });

    it('keeps the local table when a document mixes local and remote', () => {
      const content = `query {
  local: records(per_page: 1, filter: { table: { value: "local_tbl" } }) { results { id } }
  remote: remote_records(per_page: 1, endpoint: { url: "https://other" }, filter: { table: { value: "remote_tbl" } }) { results { id } }
}`;
      expect(tablesOf(content)).toEqual(['local_tbl']);
    });
  });

  describe('a table being defined rather than referenced', () => {
    it.each([
      [
        'admin_table_create',
        'mutation { admin_table_create(table: { physical_file_path: "x" }) { name } }',
      ],
      [
        'admin_table_update',
        'mutation { admin_table_update(physical_file_path: "x", table: { name: "y" }) { name } }',
      ],
    ])('does not extract the input object %s takes', (_field, content) => {
      expect(tablesOf(content)).toEqual([]);
    });
  });

  it('extracts tables nested through `or`, which is a list of the same filter input', () => {
    const content = `query {
  records(per_page: 1, filter: { or: [{ table: { value: "a" } }, { table: { value: "b" } }] }) {
    results { id }
  }
}`;
    expect(tablesOf(content)).toEqual(['a', 'b']);
  });

  it('extracts a table from the filter of a field whose selection set is a fragment', () => {
    const content = `query { records(per_page: 1, filter: { table: { value: "frag_tbl" } }) { ...F } }
fragment F on RecordCollection { total_entries }`;
    expect(tablesOf(content)).toEqual(['frag_tbl']);
  });

  it('deduplicates a table named by two separate argument-form mutations', () => {
    const content = `mutation {
  one: record_delete(id: 1, table: "t") { id }
  two: record_delete(id: 2, table: "t") { id }
}`;
    expect(tablesOf(content)).toEqual(['t']);
  });

  /**
   * Positions no FIELD encloses. A field-only walk silently drops the first of these, which is
   * why the remote exclusion is a subtree skip rather than a field-scoped collection.
   */
  describe('a table outside any field argument', () => {
    it('extracts one from a variable default value', () => {
      const content = `query find($filter: RecordsFilterInput = { table: { value: "blog_post" } }) {
  records(per_page: 20, filter: $filter) { results { id } }
}`;
      expect(tablesOf(content)).toEqual(['blog_post']);
    });

    it('extracts one from a filter inside a named fragment', () => {
      const content = `query { ...F }
fragment F on RootQuery { records(per_page: 1, filter: { table: { value: "in_frag" } }) { results { id } } }`;
      expect(tablesOf(content)).toEqual(['in_frag']);
    });

    it('extracts one from a filter inside an inline fragment', () => {
      const content = `query {
  ... on RootQuery { records(per_page: 1, filter: { table: { value: "inline" } }) { results { id } } }
}`;
      expect(tablesOf(content)).toEqual(['inline']);
    });
  });

  it('reads a block-string table argument', () => {
    const content = 'mutation { record_delete(id: 1, table: """blk""") { id } }';
    expect(tablesOf(content)).toEqual(['blk']);
  });

  it('keeps document order when one field uses both the argument and the filter form', () => {
    const content = `mutation {
  records_update_all(filter: { table: { value: "from_filter" } }, table: "from_arg", record: {}) {
    id
  }
}`;
    expect(tablesOf(content)).toEqual(['from_filter', 'from_arg']);
  });

  it('does not treat `any_table` as a table', () => {
    expect(tablesOf('mutation { records_delete_all(any_table: true) { id } }')).toEqual([]);
  });
});
