import { HashAssignMarkup, LiquidTag, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';

import { SourceCodeType, Problem } from '../../..';

/**
 * A `hash_assign` target whose final subscript uses DOT access, which the platform cannot
 * parse.
 *
 * MEASURED against `/api/app_builder/liquid_exec`, each row reading the value back so
 * "accepted" means the assignment actually happened rather than merely that it parsed:
 *
 *   {% hash_assign h['k']    = 'V' %}  assigns
 *   {% hash_assign h["k"]    = 'V' %}  assigns
 *   {% hash_assign h.a['b']  = 'V' %}  assigns      <- a DOT is fine when it is not last
 *   {% hash_assign h[k]      = 'V' %}  assigns
 *   {% hash_assign h[0]      = 'V' %}  assigns
 *   {% hash_assign h['k-1']  = 'V' %}  assigns
 *   {% hash_assign h.k       = 'V' %}  RAISES
 *   {% hash_assign h.a.b     = 'V' %}  RAISES
 *   {% hash_assign h['a'].b  = 'V' %}  RAISES
 *
 * The raise is `Liquid::SyntaxError: Syntax Error in 'hash_assign' - Valid syntax:
 * hash_assign hash[key] = value`, and it happens at PARSE time. So this is not merely a
 * deploy rejection: the template cannot be parsed at all, which is why it belongs to
 * `LiquidHTMLSyntaxError` (already blocking) rather than to `InvalidHashAssignTarget`.
 *
 * SO THE RULE IS POSITIONAL, not about the key: only the LAST lookup must be a bracket.
 * Reporting any dot in the chain would be a false block on `h.a['b']`, which works.
 *
 * AND IT IS `hash_assign`'s ALONE. `assign` and `function` write into a Hash through the same
 * runtime setter — `InvalidHashAssignTarget` treats all three alike for that reason — but they
 * do not share this PARSER. Measured, reading the hash back: `{% assign h.k = 'V' %}` writes
 * the key `k`, `{% assign h.a.b = 'V' %}` and `{% assign h['a'].b = 'V' %}` write `a.b`, and
 * every `function` target spelling reaches partial resolution rather than a syntax error.
 * Generalising this detector to them would refuse working code on a check that BLOCKS.
 *
 * WHY NOT `InvalidHashAssignTarget`. That check answers a TYPE question — is the container a
 * Hash or an Array, and does the subscript kind match — and it necessarily stays silent when
 * it cannot infer the type, which is most of the time (a render argument, a module value, a
 * variable assigned in another file). This defect has nothing to do with the type:
 * `{% hash_assign anythingAtAll.k = 1 %}` cannot be parsed whatever the variable holds. Put
 * here, it is reported unconditionally; put there, it would be silent exactly when the
 * author most needs it.
 *
 * WHY THE SOURCE AND NOT THE NODE. The AST does record the difference — a bracket lookup's
 * `String` node carries `single`, a dot lookup's does not — but `LiquidString.single` is
 * declared `boolean`, NOT optional, so that difference is a pre-existing type violation
 * rather than a contract. Nothing stops the parser from filling `single` in on dot lookups
 * as a tidy-up, and this detector would then go silent on the very construct it exists for.
 * Source POSITIONS are load-bearing, documented, and used by every check in this package, so
 * reading the notation back out of the source is the durable signal.
 *
 * NO AUTOFIX. `h.k` -> `h['k']` looks mechanical, but a dot chain can also mean the author
 * meant a different container level entirely (`h.a.b` might want `h['a']['b']` or
 * `h.a['b']`), and picking one silently rewrites intent. The message states the repair.
 */
export function detectInvalidHashAssignTargetSyntax(
  node: LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (node.name !== NamedTags.hash_assign) return;

  const markup = node.markup;
  // A raw string means the markup did not parse; `InvalidTagSyntax` already reports that.
  if (typeof markup === 'string') return;

  const target = (markup as HashAssignMarkup).target;
  if (!target || target.type !== NodeTypes.VariableLookup) return;

  const lookups = target.lookups ?? [];
  // No subscript at all (`{% hash_assign h = 1 %}`) is a different defect and not this one's
  // to report — the markup rule requires a lookup, so this is defensive rather than reachable.
  if (lookups.length === 0) return;

  const lastIndex = lookups.length - 1;
  const previousEnd = lastIndex > 0 ? lookups[lastIndex - 1].position.end : target.position.start;
  if (usesBracketNotation(node.source, previousEnd, lookups[lastIndex].position.start)) return;

  return {
    message:
      "A hash_assign target must end in a bracket subscript. Change the last '.' to " +
      "bracket access — hash_assign h['key'] = value, not hash_assign h.key = value. " +
      'platformOS raises Liquid::SyntaxError when parsing the dot form, so the file cannot ' +
      'be deployed or rendered.',
    startIndex: target.position.start,
    endIndex: target.position.end,
  };
}

/**
 * Whether the lookup starting at `lookupStart` is reached by `[...]` rather than by `.name`.
 *
 * The span between the end of the PREVIOUS lookup (or the start of the variable name, for the
 * first one) and the start of this lookup holds the delimiter and nothing else of substance.
 * Reading that gap rather than a fixed offset keeps this correct across whitespace, which the
 * grammar permits on both sides — `h [ 'k' ]` and `h . k` both parse.
 *
 * The LAST delimiter in the gap decides it, because a bracket lookup's node begins INSIDE the
 * brackets. So for `h['a']['b']` the gap before the second lookup is `][`, and for
 * `h['a'].b` it is `].` — the same two characters in the other order, which is exactly the
 * pair that has to be told apart.
 */
function usesBracketNotation(source: string, spanStart: number, lookupStart: number): boolean {
  const gap = source.slice(spanStart, lookupStart);
  return gap.lastIndexOf('[') > gap.lastIndexOf('.');
}
