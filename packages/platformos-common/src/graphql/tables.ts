import { Kind, StringValueNode, visit } from 'graphql/language';

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
 * The table appears in three positions, all MEASURED against a live schema: the shorthand
 * `table: "x"`, the object `table: { value: "x" }`, and a plain ARGUMENT — `record_delete`,
 * `records_delete_all`, `records_update_all` and `property_upload_presigned_url` each declare
 * `table` as a `String`. A document can name several, nested arbitrarily deep through
 * `RecordsFilterInput.or`; this returns every distinct one in document order.
 *
 * NOT returned: a table under a field carrying an `endpoint` argument, which names a table on
 * ANOTHER instance and joins to nothing here, and the input object `admin_table_create` /
 * `admin_table_update` take, which DEFINES a table rather than referencing one.
 *
 * Takes the {@link GraphQLDocumentNode} rather than a string, so the caller passes
 * the parse its `AppFile` already holds. Returns an empty array for an operation
 * with no table filter, a dynamic (non-string) table, or a document that did not
 * parse. Its sibling is {@link extractSchemaTable}, which reads the `name:` of the
 * schema such a table joins to.
 */
export function extractGraphqlTables(document: GraphQLDocumentNode): string[] {
  const tables: string[] = [];
  for (const reference of extractGraphqlTableReferences(document)) {
    if (!tables.includes(reference.table)) tables.push(reference.table); // distinct, first-occurrence order
  }
  return tables;
}

/** One table reference, with the source span of the string that named it. */
export interface GraphqlTableReference {
  table: string;

  /**
   * Offsets of the string literal, for a caller that reports on it. Absent only if the
   * document was parsed without location info, which {@link parseGraphql} never does.
   */
  position?: { start: number; end: number };
}

/**
 * Every table reference, in document order and NOT deduplicated, so a caller reporting on one
 * can point at the occurrence it means. {@link extractGraphqlTables} is this, deduplicated.
 */
export function extractGraphqlTableReferences(
  document: GraphQLDocumentNode,
): GraphqlTableReference[] {
  if (!document.document) return []; // not valid GraphQL — nothing to extract

  const references: GraphqlTableReference[] = [];
  const add = (node: StringValueNode) => {
    references.push({
      table: node.value,
      position: node.loc && { start: node.loc.start, end: node.loc.end },
    });
  };

  visit(document.document, {
    // `false` drops the whole subtree, ARGUMENTS INCLUDED, so neither visitor below sees a
    // remote filter. Nothing else is field-scoped, which is what keeps a table in a position
    // no field encloses — a variable's default value — covered.
    Field(node) {
      return node.arguments?.some((argument) => argument.name.value === 'endpoint')
        ? false
        : undefined;
    },

    // A STRING is the reference form; the input object the two defining mutations take is
    // excluded by that test rather than by naming them.
    Argument(node) {
      if (node.name.value === 'table' && node.value.kind === Kind.STRING) add(node.value);
    },

    ObjectField(node) {
      if (node.name.value !== 'table') return;

      // `table: "blog_post"`
      if (node.value.kind === Kind.STRING) {
        add(node.value);
        return;
      }

      // `table: { value: "blog_post" }`
      if (node.value.kind === Kind.OBJECT) {
        const valueField = node.value.fields.find(
          (field) => field.name.value === 'value' && field.value.kind === Kind.STRING,
        );
        if (valueField && valueField.value.kind === Kind.STRING) add(valueField.value);
      }
    },
  });

  return references;
}
