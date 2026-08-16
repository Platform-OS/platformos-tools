import { LiquidString, LiquidVariable, NodeTypes } from '@platformos/liquid-html-parser';

/** The filter names that mark a string literal as a translation-key lookup. */
export const TRANSLATION_FILTERS = ['t', 'translate'] as const;

/**
 * Whether a `LiquidVariable` output is a translation-key usage: a string literal piped through
 * a `t` / `translate` filter, e.g. `{{ 'greeting.hello' | t }}`.
 *
 * The literal must reach `t` UNCHANGED, so `t` has to be the first filter. A key assembled on
 * the way — `{{ 'static-pages.' | append: page.slug | append: '.title' | t }}` — is not a usage
 * of `'static-pages.'`, and reporting it as one was a false BLOCK on the ordinary way to write
 * a dynamic key. Filters AFTER `t` are ignored, since they transform the result rather than the
 * key.
 *
 * The single source of truth for "what counts as a translation-key usage", shared by the
 * `TranslationKeyExists` check and the dependency graph's extraction, so the two cannot drift.
 * Narrows `expression` to `LiquidString` so the caller can read the key from
 * `node.expression.value`.
 */
export function isTranslationKeyUsage(
  node: LiquidVariable,
): node is LiquidVariable & { expression: LiquidString } {
  return (
    node.expression.type === NodeTypes.String &&
    node.filters.length > 0 &&
    (TRANSLATION_FILTERS as readonly string[]).includes(node.filters[0].name)
  );
}
