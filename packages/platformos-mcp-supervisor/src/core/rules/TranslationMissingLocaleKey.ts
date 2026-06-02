/**
 * pos-supervisor:TranslationMissingLocaleKey rule — `app/translations/<locale>.yml`
 * is missing the top-level locale wrapper. Without `en:` (or `de:` etc.) at the
 * root, `{{ 'key' | t }}` silently returns the raw key — the file parses,
 * the LSP doesn't yell, but every translation lookup fails at runtime.
 *
 * Pre-rule the check landed as `.unmatched` even though the upstream message
 * already names the expected locale and the offending top-level keys. The
 * rule attaches a stable `rule_id`, mirrors the canonical fix (re-indent
 * existing tree under a `<locale>:` root) into a guidance fix, and points
 * at the translations domain guide.
 *
 * No `text_edit` here — re-indenting the entire file deterministically
 * requires content-aware logic that lives in fix-generator. When a heuristic
 * lands there, the rule's `guidance` will be dropped per the validate-code
 * dedup precedence; the rule_id and hint stand regardless.
 */
import type { Rule } from './engine';

const LOCALE_HINT_RE = /\(e\.g\.\s+`([a-z]{2}(?:-[A-Z]{2})?):`\)/;
const TOP_KEYS_RE = /Top-level keys found:\s*([^.]+?)(?:\s*\(\+\d+ more\))?\.\s/;

export const rules: Rule[] = [
  {
    id: 'TranslationMissingLocaleKey.default',
    check: 'pos-supervisor:TranslationMissingLocaleKey',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const msg = diag.message ?? '';
      const localeMatch = msg.match(LOCALE_HINT_RE);
      const expectedLocale = localeMatch?.[1] ?? 'en';
      const topKeysMatch = msg.match(TOP_KEYS_RE);
      const topKeysList = topKeysMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
      const example = topKeysList[0] ?? 'app';

      const beforeYaml =
        `${example}:\n` +
        `  greeting: "Hello"`;
      const afterYaml =
        `${expectedLocale}:\n` +
        `  ${example}:\n` +
        `    greeting: "Hello"`;

      return {
        rule_id: 'TranslationMissingLocaleKey.default',
        hint_md:
          `Translation file is missing the top-level locale wrapper. platformOS indexes translations under ` +
          `\`<locale>:\` at the YAML root — without it \`{{ '...' | t }}\` lookups silently return the raw key, ` +
          `even though the file parses cleanly.\n\n` +
          `Wrap the entire tree under \`${expectedLocale}:\` and indent every existing line by two spaces. ` +
          `Example transform:\n` +
          `\`\`\`yaml\n# BEFORE (broken — no locale root)\n${beforeYaml}\n\`\`\`\n` +
          `\`\`\`yaml\n# AFTER (correct)\n${afterYaml}\n\`\`\`\n` +
          `One-liner with sed: \`sed -E 's/^(.+)/  \\1/' file.yml | (echo '${expectedLocale}:'; cat) > file.yml.tmp && mv file.yml.tmp file.yml\` ` +
          `(verify after — re-run validate_code on the file).`,
        fixes: [{
          type: 'guidance',
          description:
            `Add \`${expectedLocale}:\` as the new top-level key in this file, then indent every existing line ` +
            `by two more spaces so the original tree nests under it. Re-run validate_code to confirm.`,
        }],
        confidence: 0.95,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'translations' },
          reason: 'Translations domain guide explains the locale-root requirement and lookup conventions.',
        },
      };
    },
  },
];
