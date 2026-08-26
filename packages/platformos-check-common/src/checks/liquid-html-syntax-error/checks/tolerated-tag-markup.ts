import { LiquidTag, NamedTags } from '@platformos/liquid-html-parser';

/**
 * Tag markup the grammar refuses that platformOS parses AS INTENDED, measured on a live
 * instance. The single source of truth for the split between `LiquidHTMLSyntaxError`
 * (error, blocking — silent on everything here) and `UnconventionalTagSyntax` (warning,
 * non-blocking — reports exactly this).
 *
 * An ALLOWLIST, and it must stay one. The platform matches tag markup with an unanchored
 * regex, so it also "accepts" spellings that then do the wrong thing silently — a mistyped
 * `{% cache: k %}` collapses the key to a constant and shares one cache entry across the
 * whole instance. "The platform accepts it" is therefore never sufficient grounds to add a
 * shape here; it must be measured to produce the AUTHOR'S intended result.
 *
 * Do not key on the tag name (`capture` is admitted for one shape and raises on empty
 * markup) nor on "starts with a stray separator" (`{% cache expire: 30 %}` has no leading
 * separator and collapses identically).
 */

/** `{% capture 'name' %}` — 32 corpus occurrences. Capture::Syntax finds the name inside the quotes. */
const CAPTURE_QUOTED_TARGET = /^\s*(['"])([A-Za-z_][\w-]*)\1\s*$/;

/**
 * `{% case x: %}` — trailing colon(s), optionally spaced. VariableLookup scans `[\w-]+` and
 * drops them. A name is required: `{% case : %}` looks up nil and every `when` misses.
 */
const CASE_TRAILING_COLON = /^\s*[A-Za-z_][\w-]*(?:\.[\w-]+)*\s*:+\s*$/;

/** `{% parse_json v %%}` — a stray `%` the unanchored SYNTAX never reaches. A name is required. */
const PARSE_JSON_TRAILING_PERCENT = /^\s*[A-Za-z_][\w-]*\s*%+\s*$/;

const TOLERATED: Partial<Record<string, RegExp>> = {
  [NamedTags.capture]: CAPTURE_QUOTED_TARGET,
  [NamedTags.case]: CASE_TRAILING_COLON,
  [NamedTags.parse_json]: PARSE_JSON_TRAILING_PERCENT,
};

/**
 * Callers must already have established that `node.markup` is a string — the only situation
 * in which either check runs.
 */
export function isToleratedTagMarkup(node: LiquidTag): boolean {
  if (typeof node.markup !== 'string') return false;
  const shape = TOLERATED[node.name];
  return shape !== undefined && shape.test(node.markup);
}

export const TAGS_WITH_TOLERATED_MARKUP: readonly string[] = Object.keys(TOLERATED);
