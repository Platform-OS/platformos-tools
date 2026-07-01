import { load } from 'js-yaml';

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
 * Named to mirror {@link extractGraphqlTable} so a consumer can join a GraphQL
 * operation to the schema it targets. Reuses the `js-yaml` parser this package
 * already owns rather than a regex.
 *
 * Returns `undefined` for a missing/empty/non-string `name` or unparseable YAML.
 */
export function extractSchemaTable(content: string): string | undefined {
  let data: unknown;
  try {
    data = load(content);
  } catch {
    return undefined; // not valid YAML — nothing to extract
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const name = (data as Record<string, unknown>).name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}
