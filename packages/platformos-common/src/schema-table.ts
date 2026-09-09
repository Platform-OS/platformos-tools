import { load } from 'js-yaml';

import { PLATFORM_YAML_LOAD_OPTIONS } from './yaml-load-options';

/**
 * Extract the model table name a platformOS custom model type / schema file
 * declares — its top-level YAML `name:`, e.g.
 *
 * ```yaml
 * name: blog_post
 * properties:
 *   - name: title
 *     type: string
 * ```
 *
 * `properties` is a SEQUENCE. The mapping form this example used to show is rejected on
 * deploy (`no implicit conversion of String into Integer`), measured with both a valid and
 * an invalid property type to confirm it is the shape and not the type.
 *
 * Named to mirror {@link extractGraphqlTables}, its sibling in this package, so a
 * consumer can join a GraphQL operation to the schema it targets.
 *
 * Returns `undefined` for a missing/empty/non-string `name` or unparseable YAML.
 */
export function extractSchemaTable(content: string): string | undefined {
  let data: unknown;
  try {
    // A model schema with a duplicated key still declares its table. Without the
    // shared options js-yaml throws and the `catch` drops the table name, so the
    // schema silently stops joining to the GraphQL operations that target it — on a
    // file the linter now (correctly) reports as clean.
    data = load(content, PLATFORM_YAML_LOAD_OPTIONS);
  } catch {
    return undefined; // not valid YAML — nothing to extract
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const name = (data as Record<string, unknown>).name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * The table name the platform gives a model schema — what a GraphQL `table:` must spell.
 *
 * NOT the YAML `name:` on its own. The platform runs the declared name through
 * `ParameterizedName`, which prefixes `modules/<module>/` for a schema inside a module unless
 * the name already carries it, then downcases and turns spaces into underscores.
 * `custom_model_type.rb` uses the result as the `table` of a `records_delete_all`, so this is
 * the value a query has to match. Read from the platform source, and consistent with real
 * projects, which query `modules/user/profile` for a module schema whose `name:` is `profile`.
 */
export function parameterizedTableName(name: string, moduleName?: string): string {
  const prefix = moduleName ? `modules/${moduleName}/` : '';
  const prefixed = name.startsWith(prefix) ? name : `${prefix}${name}`;

  return prefixed.toLowerCase().replaceAll(' ', '_');
}
