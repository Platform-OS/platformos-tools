import { visit } from 'graphql/language';

import { GraphQLDocumentNode } from './parse';

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
 * rather than only the first. It walks the parsed GraphQL AST rather than the
 * source with a regex.
 *
 * Takes the {@link GraphQLDocumentNode} rather than a string, so the caller passes
 * the parse its `AppFile` already holds. Returns an empty array for an operation
 * with no table filter, a dynamic (non-string) table, or a document that did not
 * parse. Its sibling is {@link extractSchemaTable}, which reads the `name:` of the
 * schema such a table joins to.
 */
export function extractGraphqlTables(document: GraphQLDocumentNode): string[] {
  if (!document.document) return []; // not valid GraphQL — nothing to extract

  const tables: string[] = [];
  const add = (value: string) => {
    if (!tables.includes(value)) tables.push(value); // distinct, first-occurrence order
  };

  visit(document.document, {
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
