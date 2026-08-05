import { load } from 'js-yaml';

import { PLATFORM_YAML_LOAD_OPTIONS } from './yaml-load-options';

/**
 * Extract the model table name a platformOS custom model type / schema file
 * declares — its top-level YAML `name:`, e.g.
 *
 * ```yaml
 * name: blog_post
 * properties:
 *   title:
 *     type: string
 * ```
 *
 * Named to mirror `extractGraphqlTables` so a consumer can join a GraphQL operation to
 * the schema it targets. That sibling lives in `platformos-check-common`, not here, and
 * the split is deliberate: it needs the `graphql` parser, while this needs only the
 * `js-yaml` reader this package already owns. `platformos-common` stays below the parser
 * stack so `App`'s parsers can be injected — see `app/package-boundaries.spec.ts`. Not a
 * `{@link}` for that reason: this package must not reference the other's symbols.
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
