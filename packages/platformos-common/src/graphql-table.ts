import { parse, visit } from 'graphql/language';

/**
 * Extract every platformOS model table a GraphQL operation targets. platformOS
 * queries and mutations reference a model by table, e.g.
 *
 * ```graphql
 * query    { records(filter: { table: { value: "blog_post" } }) { ... } }
 * mutation { record_create(record: { table: "blog_post", ... }) { id } }
 * ```
 *
 * The table appears either as the shorthand `table: "blog_post"` or as an object
 * `table: { value: "blog_post" }`. A single document can target several tables
 * (multiple `records(...)` blocks, aliased queries, `record_create` inputs), so
 * this returns ALL of them — every distinct string table in document order —
 * rather than only the first. It walks the parsed GraphQL AST, reusing the
 * `graphql` parser this package owns rather than a regex.
 *
 * Returns an empty array for operations with no table filter, a dynamic
 * (non-string) table, or unparseable input.
 */
export function extractGraphqlTables(content: string): string[] {
  let ast;
  try {
    ast = parse(content);
  } catch {
    return []; // not valid GraphQL — nothing to extract
  }

  const tables: string[] = [];
  const add = (value: string) => {
    if (!tables.includes(value)) tables.push(value); // distinct, first-occurrence order
  };

  visit(ast, {
    ObjectField(node) {
      if (node.name.value !== 'table') return;

      // `table: "blog_post"`
      if (node.value.kind === 'StringValue') {
        add(node.value.value);
        return;
      }

      // `table: { value: "blog_post" }`
      if (node.value.kind === 'ObjectValue') {
        const valueField = node.value.fields.find(
          (field) => field.name.value === 'value' && field.value.kind === 'StringValue',
        );
        if (valueField && valueField.value.kind === 'StringValue') {
          add(valueField.value.value);
        }
      }
    },
  });

  return tables;
}
