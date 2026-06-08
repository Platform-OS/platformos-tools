/**
 * DuplicateFunctionArguments rule — pos-cli 6.0.7 duplicate-arg detection.
 *
 * Upstream fires for both `{% render %}` and `{% function %}` when the same
 * argument name appears twice in a single call. Liquid's last-key-wins
 * semantics silently drops the first value, so the bug is usually a typo
 * (two args meant to be different but typed the same). The rule attaches
 * a rule_id and an action-oriented hint; upstream supplies the autofix.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'DuplicateFunctionArguments.default',
    check: 'DuplicateFunctionArguments',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const arg = diag.params?.argument ?? 'the duplicate argument';
      const tag = diag.params?.tag_kind ?? 'render';
      const partial = diag.params?.partial ?? '(unknown partial)';
      return {
        rule_id: 'DuplicateFunctionArguments.default',
        hint_md: `\`${arg}\` is passed twice to \`{% ${tag} '${partial}' %}\`. Liquid keeps the LAST occurrence and silently drops earlier ones — usually this is a typo (you meant two different keys). Decide: same value? delete one. Different values intended? rename one to its real key.`,
        fixes: [
          {
            type: 'guidance',
            description: `Open the \`{% ${tag} '${partial}' %}\` call. Remove the second \`${arg}: …\` occurrence, or rename it to whatever distinct key was meant.`,
          },
        ],
        confidence: 0.9,
      };
    },
  },
];
