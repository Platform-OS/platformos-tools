/**
 * TranslationKeyExists rules — translation key not found.
 *
 * Priority order (first match wins):
 *   5    — array_index_misuse: agent wrote `key[0]` / `key[1]` etc.
 *          platformOS translations cannot be subscripted with `[N]` —
 *          the modern pattern is `{% assign items = 'key' | t %}` then
 *          iterate with `{% for item in items %}`. Owns this case so the
 *          downstream Levenshtein rule never produces a misleading
 *          "did you mean en.key.items" suggestion.
 *   10   — suggest_nearest: key is close to an existing translation key
 *   20   — create_key:      suggest adding the key to translation file
 *  1000  — default:         catch-all for cases where extraction failed and
 *          no specialised rule's guard matched. Without this, the diagnostic
 *          would land as `TranslationKeyExists.unmatched` and the agent would
 *          see the bare LSP message.
 *
 * Defensive design: every `[N]`-aware gate looks at BOTH `params.key` and
 * `diag.message`. If the extractor ever drifts (LSP message shape change,
 * encoding glitch), the raw-message regex still owns the array-index case
 * — `suggest_nearest` won't slip through and emit a misleading parent-key
 * suggestion. See the 2026-04-25 DEMO regression: 6 emits, 6 ignored fixes.
 */
import type { Rule, RuleDiagnostic, RuleFacts } from './engine';
import { nearestByLevenshtein, stripLocalePrefix, translationKeysForLocale, type NearestMatch } from './queries';

const ARRAY_INDEX_RE = /\[\d+\]/;
const DEFAULT_LOCALE = 'en';

function hasArrayIndex(diag: RuleDiagnostic): boolean {
  return ARRAY_INDEX_RE.test(diag.params?.key ?? '') || ARRAY_INDEX_RE.test(diag.message ?? '');
}

export const rules: Rule[] = [
  {
    id: 'TranslationKeyExists.array_index_misuse',
    check: 'TranslationKeyExists',
    priority: 5,
    when: hasArrayIndex,
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const key = diag.params?.key ?? '';
      // The agent's key may include a locale prefix (`en.foo[0]`). Strip
      // before computing the array root so the suggested `| t` call works
      // — Liquid auto-prepends the locale and `'en.foo' | t` resolves to
      // `en.en.foo`.
      const bareKey = stripLocalePrefix(key, DEFAULT_LOCALE);
      const arrayKey = bareKey.replace(/\[\d+\]/g, '');
      const indexMatch = key.match(/\[(\d+)\]/);
      const indexLabel = indexMatch ? `[${indexMatch[1]}]` : '[N]';
      const guidance =
        `Translation arrays don't support [index] syntax in Liquid. ` +
        `Pass the full array, then iterate, for example: ` +
        `{% assign items = '${arrayKey}' | t %}\n` +
        `{% for item in items %}\n  <li>{{ item }}</li>\n{% endfor %}`;
      return {
        rule_id: 'TranslationKeyExists.array_index_misuse',
        hint_md:
          `Translation key \`${key}\` uses \`${indexLabel}\` indexing — not supported. ` +
          `Load the array with \`{% assign items = '${arrayKey}' | t %}\` and iterate with \`{% for %}\`.`,
        fixes: [{ type: 'guidance', description: guidance }],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'TranslationKeyExists.suggest_nearest',
    check: 'TranslationKeyExists',
    priority: 10,
    when: (diag: RuleDiagnostic, facts: RuleFacts) => {
      const key = diag.params?.key;
      if (!key) return false;
      // Array-index misuse owns its own rule above; don't double-fire here
      // (Levenshtein on `foo[0]` reliably finds a misleading parent key).
      // Defense in depth: gate on BOTH params.key and the raw message.
      if (hasArrayIndex(diag)) return false;
      if (!facts.graph) return false;
      const keys = translationKeysForLocale(facts.graph, DEFAULT_LOCALE);
      return keys.length > 0;
    },
    apply: (diag: RuleDiagnostic, facts: RuleFacts) => {
      const params = diag.params!;
      const key = params.key;
      // Compare against both the agent's literal key AND the locale-stripped
      // form. Agents do both — `'en.foo' | t` (with prefix) and `'foo' | t`
      // (without). Whichever is closer to a real key wins.
      const bareKey = stripLocalePrefix(key, DEFAULT_LOCALE);
      const candidates = translationKeysForLocale(facts.graph!, DEFAULT_LOCALE);
      const nearestBare = nearestByLevenshtein(bareKey, candidates, 3);
      const nearestRaw = nearestByLevenshtein(key, candidates, 3);
      const pickBest = (a: NearestMatch[], b: NearestMatch[]): NearestMatch[] => {
        if (a.length === 0) return b;
        if (b.length === 0) return a;
        return a[0].distance <= b[0].distance ? a : b;
      };
      // The shared Levenshtein helper uses a length-relative threshold
      // (`length * 0.6`) which is fine for 5-15 char identifiers but lets
      // unrelated 20+ char dotted keys through (e.g. `app.brand_new.label`
      // matches `app.user.name` at distance 10/19). Re-filter at a stricter
      // bound so brand-new keys fall through to `create_key` instead of
      // attracting a bogus "did you mean".
      const SUGGEST_MAX_DISTANCE = Math.min(5, Math.floor(bareKey.length / 3));
      const nearest = pickBest(nearestBare, nearestRaw)
        .filter(n => n.distance <= SUGGEST_MAX_DISTANCE);
      if (nearest.length === 0) return null;

      const bestMatch = nearest[0].name;
      const suggestions = nearest.map(n => `\`${n.name}\``).join(', ');
      return {
        rule_id: 'TranslationKeyExists.suggest_nearest',
        hint_md:
          `Translation key \`${key}\` not found. Did you mean: ${suggestions}? ` +
          `Use the suggested key directly in \`'<key>' | t\` — Liquid auto-prepends the locale, so do NOT include \`${DEFAULT_LOCALE}.\` yourself. ` +
          `Or add the key to \`app/translations/${DEFAULT_LOCALE}.yml\`.`,
        fixes: [{
          type: 'guidance',
          description:
            `Replace \`${key}\` with \`${bestMatch}\` everywhere this key is referenced in the file ` +
            `(\`{{ '...' | t }}\`, \`{% assign x = '...' | t %}\`, etc). Do not include the \`${DEFAULT_LOCALE}.\` prefix — ` +
            `\`| t\` resolves the active locale automatically.`,
        }],
        confidence: 0.7,
      };
    },
  },

  {
    id: 'TranslationKeyExists.create_key',
    check: 'TranslationKeyExists',
    priority: 20,
    when: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const key = diag.params?.key;
      if (!key) return false;
      // Don't propose creating `foo[0]: TODO` — array_index_misuse owns this.
      // Defense in depth: gate on both params.key and the raw message.
      if (hasArrayIndex(diag)) return false;
      return true;
    },
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const params = diag.params!;
      const key = params.key;
      // Build the YAML snippet from the bare (locale-stripped) key so the
      // generated YAML nests under the correct root (en:) without doubling.
      const bareKey = stripLocalePrefix(key, DEFAULT_LOCALE);
      const parts = bareKey.split('.');
      const yamlLines: string[] = [];
      parts.forEach((part, i) => {
        if (i < parts.length - 1) {
          yamlLines.push(`${'  '.repeat(i)}${part}:`);
        } else {
          yamlLines.push(`${'  '.repeat(i)}${part}: "TODO"`);
        }
      });
      const snippet = yamlLines.join('\n');

      return {
        rule_id: 'TranslationKeyExists.create_key',
        hint_md: `Add translation key \`${bareKey}\` to \`app/translations/${DEFAULT_LOCALE}.yml\` (under the \`${DEFAULT_LOCALE}:\` root):\n\`\`\`yaml\n${snippet}\n\`\`\``,
        fixes: [{
          type: 'guidance',
          description: `Add the following YAML to \`app/translations/${DEFAULT_LOCALE}.yml\` (nested under the existing \`${DEFAULT_LOCALE}:\` root):\n${snippet}`,
        }],
        confidence: 0.8,
      };
    },
  },

  // Last-resort catch-all. Triggered when the LSP emits a translation-key
  // diagnostic whose message did not yield a `params.key` (extractor drift,
  // unrecognised wording). Emits a generic but typed hint so the row is
  // attributed to a real rule_id rather than `.unmatched`.
  {
    id: 'TranslationKeyExists.default',
    check: 'TranslationKeyExists',
    priority: 1000,
    when: () => true,
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const key = diag.params?.key ?? null;
      const ref = key ? `\`${key}\`` : 'this translation key';
      return {
        rule_id: 'TranslationKeyExists.default',
        hint_md:
          `${ref} is not defined in any translation file under \`app/translations/\`. ` +
          `Two valid resolutions:\n` +
          `  • **Typo** — correct the key in the \`{{ '...' | t }}\` call site. ` +
          `Do NOT prepend the locale (\`${DEFAULT_LOCALE}.\`) — \`| t\` resolves the active ` +
          `locale automatically.\n` +
          `  • **Missing key** — add it to \`app/translations/${DEFAULT_LOCALE}.yml\` under the ` +
          `\`${DEFAULT_LOCALE}:\` root, mirroring the dot-path of the call.\n\n` +
          `If you're mid-feature and the key is part of the plan but not yet on disk, pass ` +
          `\`pending_translations=[<key>]\` to validate_code so this stops firing while you write it.`,
        fixes: [{
          type: 'guidance',
          description: key
            ? `Reconcile \`${key}\` with \`app/translations/${DEFAULT_LOCALE}.yml\`: either fix the call-site spelling or add the key under the \`${DEFAULT_LOCALE}:\` root.`
            : `Inspect \`app/translations/${DEFAULT_LOCALE}.yml\` and reconcile the failing key.`,
        }],
        confidence: 0.5,
      };
    },
  },
];
