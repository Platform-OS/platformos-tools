import {
  LiquidExpression,
  LiquidTag,
  LiquidVariableLookup,
  NamedTags,
  NodeTypes,
} from '@platformos/liquid-html-parser';

import { SourceCodeType, Problem } from '../../..';

/**
 * A `hash_assign` target the platform cannot parse: one whose final subscript uses DOT
 * access, or one with no subscript at all.
 *
 * MEASURED on a live instance (`pos-cli exec liquid dev`; the dot rows re-run 2026-08-08, the
 * bare-target rows 2026-08-16), each reading the hash back so "assigns" means the write
 * happened rather than merely that it parsed:
 *
 *   {% hash_assign h['k']    = 'V' %}  -> {"k":"V"}
 *   {% hash_assign h["k"]    = 'V' %}  -> {"k":"V"}
 *   {% hash_assign h.a['b']  = 'V' %}  -> {"a":{"b":"V"}}   <- a DOT is fine when NOT last
 *   {% hash_assign h[k]      = 'V' %}  -> {"kk":"V"}        <- k = 'kk'
 *   {% hash_assign h[0]      = 'V' %}  -> {"0":"V"}
 *   {% hash_assign h['k-1']  = 'V' %}  -> {"k-1":"V"}
 *   {% hash_assign h.k       = 'V' %}  RAISES
 *   {% hash_assign h.a.b     = 'V' %}  RAISES
 *   {% hash_assign h['a'].b  = 'V' %}  RAISES
 *   {% hash_assign h         = 'V' %}  RAISES  <- for a Hash target as much as a number
 *
 * The raise is `Liquid::SyntaxError: Syntax Error in 'hash_assign' - Valid syntax:
 * hash_assign hash[key] = value`, and it happens at PARSE time. So this is not merely a
 * deploy rejection: the template cannot be parsed at all, which is why it belongs to
 * `LiquidHTMLSyntaxError` (already blocking) rather than to `InvalidWriteTarget`.
 *
 * SO THE RULE IS POSITIONAL, not about the key: only the LAST lookup must be a bracket, and
 * there must BE a last lookup. Reporting any dot in the chain would be a false block on
 * `h.a['b']`, which works.
 *
 * THE BARE TARGET IS REACHABLE, whatever an earlier reading of the grammar claimed: this
 * repository's `liquidTagHashAssignMarkup` is a `liquidVariableLookup`, which matches a plain
 * name with zero lookups. `{% hash_assign h = 'V' %}` therefore PARSES here and raises there.
 *
 * THE LIMIT IS THIS TAG'S PARSER, NOT THE RUNTIME SETTER. `assign` and `function` write into a
 * Hash through the same setter — `InvalidWriteTarget` treats all three alike for that
 * reason — but they do not share this parse rule, and for `assign` A DOT IS A PATH SEPARATOR
 * exactly as a bracket is:
 *
 *   {% assign h = {"a": {"b": "old"}} %}{% assign h.a.b    = 'NEW' %} -> {"a":{"b":"NEW"}}
 *   {% assign h = {"a": {"b": "old"}} %}{% assign h['a'].b = 'NEW' %} -> {"a":{"b":"NEW"}}
 *   {% assign h = {}                  %}{% assign h.k      = 'V'   %} -> {"k":"V"}
 *   {% assign h = {"x": 1}            %}{% assign h.y.z    = 'V'   %} -> RAISES "h[y] is null,
 *                                                                        expected Hash or Array"
 *
 * `h.a.b`, `h['a'].b` and `h['a']['b']` are the SAME write, and a missing intermediate raises
 * rather than being created. So the two tags disagree in the only direction that costs nobody
 * anything: the spelling `hash_assign` refuses is one its successor accepts and handles
 * correctly, which is why nothing needs fixing on the platform side and why renaming the tag
 * is a repair rather than a risk.
 *
 * TWO THINGS FOLLOW. Do not generalise this detector to `assign` — it BLOCKS, so that would
 * refuse working code. And do not "repair" a dot target on the belief that `h.a.b` writes a key
 * literally named `a.b`: it does not, and `deprecated-tag/index.spec.ts` pins the rename such a
 * guard would suppress.
 *
 * WHY NOT `InvalidWriteTarget`. That check answers a TYPE question — is the container a
 * Hash or an Array, and does the subscript kind match — and it necessarily stays silent when
 * it cannot infer the type, which is most of the time (a render argument, a module value, a
 * variable assigned in another file). This defect has nothing to do with the type:
 * `{% hash_assign anythingAtAll.k = 1 %}` cannot be parsed whatever the variable holds. Put
 * here, it is reported unconditionally; put there, it would be silent exactly when the
 * author most needs it.
 *
 * HOW THE NOTATION IS READ. `LiquidString.unquoted` is set by, and only by, the parser's
 * `dotLookup` mapping: the `k` in `h.k` is an identifier the grammar takes without quotes,
 * so it is the one lookup shape that has no quotes to record. It is a POSITIVE signal —
 * `single` is `false` for a double-quoted string too and so can never tell the two apart.
 *
 * This detector used to scan the source between two lookups for the last `[` or `.`, because
 * the only available signal was that a dot lookup's `String` node was MISSING `single` — a
 * violation of its own `boolean` declaration, which a tidy-up could have removed and taken
 * this diagnostic with it. `unquoted` replaced that; the scan and the marker were measured to
 * agree on every target the grammar accepts before it was removed.
 *
 * NO AUTOFIX HERE, and not because the repair is unclear: the table above makes
 * `h.a.b` -> `h['a']['b']` well defined, so it would be sound. It is that `DeprecatedTag`
 * already rewrites the whole tag to `{% assign %}`, which takes the author's spelling
 * unchanged and is where the platform wants them anyway — and two code actions disagreeing
 * about what to change on one node is worse than one.
 *
 * That argument is only as strong as `DeprecatedTag` being enabled, which is per-project. A
 * project that disables it gets this diagnostic and no fix at all. Revisit if that becomes a
 * complaint, or if `hash_assign` ever outlives the deprecation.
 */
export function detectInvalidHashAssignTargetSyntax(
  node: LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (node.name !== NamedTags.hash_assign) return;

  // A raw string means the markup did not parse; `InvalidTagSyntax` already reports that. The
  // declared markup type does not admit one, so this is a runtime guard rather than a narrowing.
  if (typeof node.markup === 'string') return;

  // Declared `LiquidVariableLookup`, and checked anyway for the reason this file gives below: a
  // parser type declaration is not a contract here, and a throw would be worse than a silence.
  const target: LiquidVariableLookup | undefined = node.markup.target;
  if (!target || target.type !== NodeTypes.VariableLookup) return;

  // The rule is POSITIONAL: there must BE a last lookup, and it must be a bracket.
  const last = (target.lookups ?? []).at(-1);
  if (last && !isDotLookup(last)) return;

  return {
    message: INVALID_TARGET,
    startIndex: target.position.start,
    endIndex: target.position.end,
  };
}

/**
 * ONE message for both shapes, because both have the same repair: the dot target and the bare
 * target are each valid under `{% assign %}`, which is where `DeprecatedTag` already points the
 * author and where the platform wants this tag anyway.
 */
const INVALID_TARGET =
  "A hash_assign target must end in a bracket subscript — hash_assign h['key'] = value. " +
  'platformOS raises Liquid::SyntaxError at parse time for any other form, so the file cannot ' +
  'be deployed or rendered. Rename the tag to {% assign %}, which accepts all of them.';

/**
 * Whether a lookup was reached by `.name` rather than by `[...]`.
 *
 * Every other lookup shape is a bracket by construction: `h[0]` is a `Number`, `h[y]` is a
 * `VariableLookup`, and `h['k']` is a String the parser did NOT mark, since it had quotes.
 */
function isDotLookup(lookup: LiquidExpression): boolean {
  return lookup.type === NodeTypes.String && lookup.unquoted === true;
}
