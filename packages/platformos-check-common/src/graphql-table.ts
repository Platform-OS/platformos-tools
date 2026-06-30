import { parse, visit } from 'graphql/language';

/**
 * Extract the platformOS model table a GraphQL operation targets, if it declares
 * one. platformOS queries filter records by table, e.g.
 *
 * ```graphql
 * query { records(filter: { table: { value: "blog_post" } }) { ... } }
 * ```
 *
 * The table also appears in the shorthand `table: "blog_post"`. This walks the
 * parsed GraphQL AST for the first `table` object field and reads its string
 * value (either a direct `StringValue`, or an object `{ value: "..." }`),
 * reusing the `graphql` parser this package already owns rather than a regex.
 *
 * Returns `undefined` for operations with no table filter or unparseable input.
 */
export function extractGraphqlTable(content: string): string | undefined {
  let ast;
  try {
    ast = parse(content);
  } catch {
    return undefined; // not valid GraphQL — nothing to extract
  }

  let table: string | undefined;
  visit(ast, {
    ObjectField(node) {
      if (table !== undefined) return; // first table wins
      if (node.name.value !== 'table') return;

      // `table: "blog_post"`
      if (node.value.kind === 'StringValue') {
        table = node.value.value;
        return;
      }

      // `table: { value: "blog_post" }`
      if (node.value.kind === 'ObjectValue') {
        const valueField = node.value.fields.find(
          (field) => field.name.value === 'value' && field.value.kind === 'StringValue',
        );
        if (valueField && valueField.value.kind === 'StringValue') {
          table = valueField.value.value;
        }
      }
    },
  });

  return table;
}
