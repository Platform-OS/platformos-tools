import { LiquidString, LiquidVariable, NodeTypes } from '@platformos/liquid-html-parser';

/** The filter names that mark a string literal as a translation-key lookup. */
export const TRANSLATION_FILTERS = ['t', 'translate'] as const;

/**
 * Whether a `LiquidVariable` output is a translation-key usage: a string literal
 * piped through a `t` / `translate` filter, e.g. `{{ 'greeting.hello' | t }}`.
 *
 * The single source of truth for "what counts as a translation-key usage",
 * shared by the `TranslationKeyExists` check and the dependency graph's
 * self-structural extraction, so the two cannot drift. Narrows `expression` to
 * `LiquidString` so the caller can read the key from `node.expression.value`
 * (and its `.position`).
 */
export function isTranslationKeyUsage(
  node: LiquidVariable,
): node is LiquidVariable & { expression: LiquidString } {
  return (
    node.expression.type === NodeTypes.String &&
    node.filters.some(({ name }) => (TRANSLATION_FILTERS as readonly string[]).includes(name))
  );
}
