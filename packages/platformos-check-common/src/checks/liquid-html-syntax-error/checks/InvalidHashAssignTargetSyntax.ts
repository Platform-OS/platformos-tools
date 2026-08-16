import {
  LiquidExpression,
  LiquidTag,
  LiquidVariableLookup,
  NamedTags,
  NodeTypes,
} from '@platformos/liquid-html-parser';

import { SourceCodeType, Problem } from '../../..';

/**
 * A `hash_assign` target the platform cannot parse: one whose final subscript uses DOT access,
 * or one with no subscript at all.
 *
 * MEASURED on a live instance (`pos-cli exec liquid dev`), each reading the hash back so
 * "assigns" means the write happened rather than merely that it parsed:
 *
 *   {% hash_assign h['k']    = 'V' %}  -> {"k":"V"}
 *   {% hash_assign h.a['b']  = 'V' %}  -> {"a":{"b":"V"}}   <- a DOT is fine when NOT last
 *   {% hash_assign h[k]      = 'V' %}  -> {"kk":"V"}        <- k = 'kk'
 *   {% hash_assign h[0]      = 'V' %}  -> {"0":"V"}
 *   {% hash_assign h.k       = 'V' %}  RAISES
 *   {% hash_assign h.a.b     = 'V' %}  RAISES
 *   {% hash_assign h['a'].b  = 'V' %}  RAISES
 *   {% hash_assign h         = 'V' %}  RAISES  <- for a Hash target as much as a number
 *
 * The raise is `Liquid::SyntaxError: Syntax Error in 'hash_assign'` at PARSE time, so the
 * template cannot be parsed at all — which is why this belongs to `LiquidHTMLSyntaxError`
 * (already blocking) rather than to `InvalidWriteTarget`.
 *
 * SO THE RULE IS POSITIONAL, not about the key: only the LAST lookup must be a bracket, and
 * there must BE a last lookup. Reporting any dot in the chain would be a false block on
 * `h.a['b']`, which works. The bare target is reachable because this repository's
 * `liquidTagHashAssignMarkup` is a `liquidVariableLookup`, which matches a plain name.
 *
 * THE LIMIT IS THIS TAG'S PARSER, NOT THE RUNTIME SETTER. `assign` and `function` write into a
 * Hash through the same setter, but they do not share this parse rule, and for `assign` A DOT IS
 * A PATH SEPARATOR exactly as a bracket is — `h.a.b`, `h['a'].b` and `h['a']['b']` are the SAME
 * write, and a missing intermediate raises rather than being created. So the spelling
 * `hash_assign` refuses is one its successor accepts and handles correctly, which is why
 * renaming the tag is a repair rather than a risk.
 *
 * TWO THINGS FOLLOW. Do not generalise this detector to `assign` — it BLOCKS, so that would
 * refuse working code. And do not "repair" a dot target on the belief that `h.a.b` writes a key
 * literally named `a.b`: it does not.
 *
 * WHY NOT `InvalidWriteTarget`. That check answers a TYPE question and necessarily stays silent
 * when it cannot infer the type, which is most of the time. This defect has nothing to do with
 * the type: `{% hash_assign anythingAtAll.k = 1 %}` cannot be parsed whatever the variable holds.
 *
 * HOW THE NOTATION IS READ. `LiquidString.unquoted` is set by, and only by, the parser's
 * `dotLookup` mapping, so it is a POSITIVE signal — `single` is `false` for a double-quoted
 * string too and can never tell the two apart.
 *
 * NO AUTOFIX HERE, and not because the repair is unclear: `h.a.b` -> `h['a']['b']` is well
 * defined. It is that `DeprecatedTag` already rewrites the whole tag to `{% assign %}`, which
 * takes the author's spelling unchanged, and two code actions disagreeing about one node is
 * worse than one. That argument is only as strong as `DeprecatedTag` being enabled, which is
 * per-project.
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
