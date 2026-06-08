/**
 * Translation-key index — a snapshot of every translation key currently in
 * `app/translations/*.yml`, stripped of the locale prefix.
 *
 * Purpose: the LSP's `TranslationKeyExists` check has the same cache-lag
 * symptom as `MissingAsset`. After the agent writes a key to
 * `app/translations/en.yml`, the LSP keeps reporting "translation key not
 * found" until its internal index re-builds.
 *
 * This module lets the diagnostic pipeline cross-check `TranslationKeyExists`
 * against the real filesystem and suppress diagnostics whose keys are
 * present in any `app/translations/<locale>.yml`. Real misses (the key is
 * not in any locale file) still surface — exactly the behaviour assets get
 * from `verifyMissingAssets`.
 *
 * Scope is limited to top-level `app/translations/*.yml` files. Subdirectory
 * support (`app/translations/en/foo.yml`) is intentionally not added — the
 * project moved to single-file-per-locale.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const TRANSLATIONS_SUBDIR = 'app/translations';

export interface TranslationIndex {
  /**
   * Dot-notation keys with the locale prefix STRIPPED.
   * `en: { app: { dashboard: { recent_notes: "..." } } }` indexes as
   * `app.dashboard.recent_notes`. Multiple locales contribute to the same
   * key set — the LSP doesn't care which locale the key lives in for
   * "key exists" purposes.
   */
  keys: Set<string>;
}

/**
 * Walk `projectDir/app/translations/*.yml` and return a flat key set.
 *
 * Missing directory or unreadable / malformed files yield an empty set; the
 * caller treats an empty set as "no suppression possible".
 */
export function buildTranslationIndex(projectDir: string): TranslationIndex {
  const keys = new Set<string>();
  if (!projectDir) return { keys };

  const rootAbs = join(projectDir, TRANSLATIONS_SUBDIR);
  if (!existsSync(rootAbs)) return { keys };

  let entries;
  try {
    entries = readdirSync(rootAbs, { withFileTypes: true });
  } catch {
    return { keys };
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) continue;

    const abs = join(rootAbs, entry.name);
    let raw: string;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;

    // Top-level keys are locale codes (en, pl, de, …). Strip them — the
    // LSP reports keys without a locale prefix.
    for (const localeTree of Object.values(parsed as Record<string, unknown>)) {
      if (typeof localeTree !== 'object' || localeTree === null) continue;
      flattenInto(localeTree as Record<string, unknown>, '', keys);
    }
  }

  return { keys };
}

function flattenInto(obj: Record<string, unknown>, prefix: string, out: Set<string>): void {
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenInto(v as Record<string, unknown>, next, out);
    } else {
      out.add(next);
    }
  }
}
