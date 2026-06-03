/**
 * platformOS translation YAML validator.
 *
 * Validates `app/translations/*.yml` files for the structural invariant the
 * LSP's `TranslationKeyExists` check silently depends on: the document MUST
 * be keyed by locale at the top level. A file written as
 *
 *   app:
 *     contact_form:
 *       title: "..."
 *
 * parses fine and the LSP won't yell, but `{{ 'app.contact_form.title' | t }}`
 * will never resolve — `translation-index` strips the top-level key assuming
 * it's a locale, so the usable key becomes `contact_form.title` (wrong) instead
 * of `app.contact_form.title`. The fix is to wrap the tree in the file's
 * locale:
 *
 *   en:
 *     app:
 *       contact_form:
 *         title: "..."
 *
 * This validator catches the missing-locale-wrapper case up front so the agent
 * never ships a translation file that silently fails lookup at runtime.
 */

import yaml from 'js-yaml';
import { basename } from 'node:path';
import type { Severity } from './constants';

// ── Public types ───────────────────────────────────────────────────────────

export interface TranslationValidatorDiagnostic {
  check: string;
  severity: Severity;
  message: string;
  line: number;
  column: number;
}

export interface TranslationValidatorResult {
  errors: TranslationValidatorDiagnostic[];
  warnings: TranslationValidatorDiagnostic[];
}

// ── Constants ──────────────────────────────────────────────────────────────

// ISO 639-1 two-letter language codes (full list). A looser pattern like
// /^[a-z]{2,3}$/ would false-positive on plain English words such as `app` or
// `ecommerce` — exactly the tokens an agent is tempted to put at the root.
// Pair with an optional ISO 3166-1 region (pt-BR, zh-CN).
const ISO_639_1: ReadonlySet<string> = new Set([
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
]);

const REGION_RE = /^[A-Z]{2}$/;

// ── Internal types ─────────────────────────────────────────────────────────

interface YamlExceptionLike {
  reason?: string;
  message?: string;
  mark?: { line?: number; column?: number };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Validate a platformOS translation YAML file.
 *
 * @param content  Raw YAML content
 * @param filePath File path, used for the filename-vs-locale fallback
 */
export function validateTranslationYaml(
  content: string,
  filePath: string,
): TranslationValidatorResult {
  const errors: TranslationValidatorDiagnostic[] = [];
  const warnings: TranslationValidatorDiagnostic[] = [];

  if (typeof content !== 'string' || content.trim() === '') {
    return { errors, warnings };
  }

  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch (e) {
    const err = e as YamlExceptionLike;
    errors.push({
      check: 'pos-supervisor:TranslationYAML',
      severity: 'error',
      message: `Invalid YAML syntax: ${err.reason ?? err.message ?? String(e)}`,
      line: err.mark?.line ?? 0,
      column: err.mark?.column ?? 0,
    });
    return { errors, warnings };
  }

  if (doc === null || doc === undefined) {
    return { errors, warnings };
  }

  if (typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push({
      check: 'pos-supervisor:TranslationStructure',
      severity: 'error',
      message:
        'Translation file must be a YAML object keyed by locale (e.g. `en:`, `de:`, `pt-BR:`).',
      line: 0,
      column: 0,
    });
    return { errors, warnings };
  }

  const topKeys = Object.keys(doc as Record<string, unknown>);
  if (topKeys.length === 0) return { errors, warnings };

  const localeFromFilename = basename(filePath).replace(/\.ya?ml$/, '');
  const expectedLocale = isLocaleKey(localeFromFilename) ? localeFromFilename : 'en';

  const nonLocaleKeys = topKeys.filter((k) => !isLocaleKey(k));

  // Case 1: zero top-level locale keys — the whole tree is wrongly un-wrapped.
  // This is the common agent mistake (no `en:` at the top). Error, not warning,
  // because the file will silently fail `| t` lookup in Liquid.
  if (nonLocaleKeys.length === topKeys.length) {
    const preview = topKeys.slice(0, 3).join(', ');
    errors.push({
      check: 'pos-supervisor:TranslationMissingLocaleKey',
      severity: 'error',
      message:
        `Translation file has no top-level locale key. Top-level keys found: ${preview}` +
        `${topKeys.length > 3 ? ` (+${topKeys.length - 3} more)` : ''}. ` +
        `Wrap the entire tree in the file's locale (e.g. \`${expectedLocale}:\`) — ` +
        `platformOS indexes translations by locale at the root. Without this wrapper, ` +
        `\`{{ 'key' | t }}\` lookups will silently fail even though the file parses.`,
      line: findKeyLine(content, topKeys[0]),
      column: 0,
    });
    return { errors, warnings };
  }

  // Case 2: mixed locale and non-locale top-level keys. The non-locale keys
  // are orphaned translations — they won't be found by any locale.
  for (const key of nonLocaleKeys) {
    warnings.push({
      check: 'pos-supervisor:TranslationStrayTopKey',
      severity: 'warning',
      message:
        `Top-level key \`${key}\` is not a locale code and will not be indexed — ` +
        `platformOS only reads keys under locale roots (\`en:\`, \`de:\`, etc.). ` +
        `Move \`${key}\` under the correct locale, or rename it to a locale code.`,
      line: findKeyLine(content, key),
      column: 0,
    });
  }

  return { errors, warnings };
}

// ── Internals ──────────────────────────────────────────────────────────────

function isLocaleKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  const parts = key.split('-');
  if (parts.length > 2) return false;
  const [lang, region] = parts;
  if (!ISO_639_1.has(lang)) return false;
  if (region !== undefined && !REGION_RE.test(region)) return false;
  return true;
}

function findKeyLine(content: string, key: string): number {
  const lines = content.split('\n');
  const re = new RegExp(`^${escapeRegex(key)}:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
