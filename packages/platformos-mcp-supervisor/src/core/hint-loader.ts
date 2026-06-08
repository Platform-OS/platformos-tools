/**
 * Reference-driven error hint loader.
 *
 * Lazily reads `data/hints/<Check>[-<variant>].md` on first access and caches
 * the rendered template body. Hint filenames are bare check names (no
 * `pos-supervisor:` prefix) so they stay portable on Windows / NTFS where
 * `:` is reserved — the prefix is stripped at lookup time.
 *
 * The hint engine supports a small Mustache-like template language:
 *   {{var}}                                 — variable substitution
 *   {{#if var}}…{{else}}…{{/if}}            — conditional with else
 *   {{#if var}}…{{/if}}                     — conditional without else
 *   {{#unless var}}…{{/unless}}             — negated conditional
 *
 * When no `vars` are supplied and no conditionals exist, unresolved `{{var}}`
 * tokens are stripped to produce a safe generic hint.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * `__dirname` resolves to `dist/core/` after build and to `src/core/` in
 * dev / vitest. In both layouts, `../data/hints` is the correct location
 * because the post-build `copy-data` step mirrors `src/data` into `dist/data`.
 */
const HINTS_DIR = join(__dirname, '..', 'data', 'hints');

export type HintVars = Record<string, string | number | boolean | null | undefined>;

const cache = new Map<string, string>();
let loaded = false;

function loadAll(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(HINTS_DIR)) return;
  for (const file of readdirSync(HINTS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const key = basename(file, '.md');
    cache.set(key, readFileSync(join(HINTS_DIR, file), 'utf-8').trim());
  }
}

function isTruthy(v: HintVars[string]): boolean {
  return v !== false && v !== null && v !== undefined && v !== '';
}

/**
 * Get a hint for a linter check, with optional template-variable substitution.
 *
 * @param checkName e.g. `'MissingPartial'`, `'pos-supervisor:HtmlInPage'`
 * @param variant   e.g. `'partial'` selects `MissingPartial-partial.md`
 * @param vars      values for `{{var}}` / `{{#if var}}` tokens
 * @returns the rendered hint, or `null` if no matching file exists
 */
export function getHint(
  checkName: string,
  variant: string | null = null,
  vars: HintVars = {},
): string | null {
  loadAll();

  const key = checkName.replace(/^pos-supervisor:/, '');
  let hint: string | null = null;
  if (variant) {
    hint = cache.get(`${key}-${variant}`) ?? null;
  }
  if (hint === null) {
    hint = cache.get(key) ?? null;
  }
  if (hint === null) return null;

  const hasVars = Object.keys(vars).length > 0;
  const hasConditionals = /\{\{#(?:if|unless)\s+\w+\}\}/.test(hint);

  // No vars and no conditionals → strip unresolved tokens to produce a safe generic hint.
  if (!hasVars && !hasConditionals) {
    return hint
      .replace(/\{\{(\w+)\}\}/g, '')
      .replace(/ {2,}/g, ' ')
      .replace(/ ([.,])/g, '$1')
      .trim();
  }

  // 1. {{#if var}}…{{else}}…{{/if}} — most specific, apply first.
  hint = hint.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, truePart: string, falsePart: string) =>
      isTruthy(vars[varName]) ? truePart : falsePart,
  );

  // 2. {{#if var}}…{{/if}}
  hint = hint.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, body: string) => (isTruthy(vars[varName]) ? body : ''),
  );

  // 3. {{#unless var}}…{{/unless}}
  hint = hint.replace(
    /\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_match, varName: string, body: string) => (isTruthy(vars[varName]) ? '' : body),
  );

  // 4. Simple {{var}} substitution. When no vars were supplied (only
  //    conditionals), skip the cleanup pass so the hint keeps any literal
  //    `{{var}}` content the template intentionally produced.
  if (!hasVars) return hint;
  return hint
    .replace(/\{\{(\w+)\}\}/g, (_match, varName: string) =>
      varName in vars ? String(vars[varName] ?? '') : '',
    )
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,])/g, '$1')
    .trim();
}

/** Reset the in-memory cache. For tests only. */
export function _resetHintCache(): void {
  cache.clear();
  loaded = false;
}
