import { LiquidTag, NamedTags } from '@platformos/liquid-html-parser';
import { baseTagValue } from './base-tag-value';

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

/**
 * `{% response_headers '{ "K" : "a 'b' c" }' %}` — nested quotes.
 *
 * NOT a shape test. No syntactic rule works here: `'{ "K" : "a' 'b" }'` has an even number of
 * quotes and fails with HTTP 501, so quote parity admits what the platform refuses. The tag
 * needs one thing — an argument that parses as a JSON object — so that is what is checked, on
 * the value {@link baseTagValue} says the tag will actually receive.
 *
 * Measured over 26 argument shapes against a live instance: 0 false approvals, 0 false blocks.
 */
function isParseableHeaderJson(markup: string): boolean {
  const value = baseTagValue(markup);
  if (value === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

const matches = (shape: RegExp) => (markup: string) => shape.test(markup);

const TOLERATED: Partial<Record<string, (markup: string) => boolean>> = {
  [NamedTags.capture]: matches(CAPTURE_QUOTED_TARGET),
  [NamedTags.case]: matches(CASE_TRAILING_COLON),
  [NamedTags.parse_json]: matches(PARSE_JSON_TRAILING_PERCENT),
  [NamedTags.response_headers]: isParseableHeaderJson,
};

/**
 * Callers must already have established that `node.markup` is a string — the only situation
 * in which either check runs.
 */
export function isToleratedTagMarkup(node: LiquidTag): boolean {
  if (typeof node.markup !== 'string') return false;
  const admits = TOLERATED[node.name];
  return admits !== undefined && admits(node.markup);
}

export const TAGS_WITH_TOLERATED_MARKUP: readonly string[] = Object.keys(TOLERATED);
