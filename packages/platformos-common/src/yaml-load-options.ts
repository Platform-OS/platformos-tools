import type { LoadOptions } from 'js-yaml';

/**
 * How this repo reads platformOS YAML: a REPEATED KEY IS NOT AN ERROR. The last value wins and
 * the file still loads.
 *
 * A NAMED CONSTANT because `js-yaml` defaults to throwing `duplicated mapping key`, and every
 * YAML reader in this package wraps its `load` in a `try`/`catch` that answers "then this file
 * has nothing in it". So the default does not produce a reported error but a SILENT, much
 * larger claim: one duplicated key and a translation file contributes no translations, a model
 * schema has no table, a page has no frontmatter.
 *
 * The platform disagrees: `pos-cli deploy --dry-run` accepts a duplicated key at the top level,
 * inside a property, and in a translation file, and resolves it last-wins. `check-common`'s
 * `yaml/parse.ts` carries the same decision for the parser that feeds the linter's AST.
 *
 * `json: true` is js-yaml's name for the overwrite behaviour, and it changes nothing else —
 * verified across 26 constructs where output is identical with and without it.
 *
 * Use this at EVERY `yaml.load` call site. A reader that keeps the default is not stricter, it
 * is quieter, and it disagrees with the linter about what the file says.
 */
export const PLATFORM_YAML_LOAD_OPTIONS: LoadOptions = { json: true };
