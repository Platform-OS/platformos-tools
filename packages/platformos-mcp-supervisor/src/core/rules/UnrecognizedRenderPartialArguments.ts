/**
 * UnrecognizedRenderPartialArguments rule — `{% render 'X', extra: ... %}`
 * passed an argument the partial's `{% doc %}` block does not declare.
 *
 * Upstream message shape:
 *   "Unknown argument 'extra' in render tag for partial 'modules/foo/bar'."
 *
 * Pre-rule path: error-enricher had no handler for this check, and the hint
 * loader rendered the templated `UnrecognizedRenderPartialArguments.md` with
 * EMPTY vars — the agent saw "Argument '' passed to ''" with literal blanks.
 * That neutered both the diagnosis and the recommended fix and meant the
 * check landed in analytics as `.unmatched`.
 *
 * This rule extracts the partial path + offending argument from the message
 * directly so the hint always carries concrete identifiers, gives the agent
 * three explicit options (drop arg / declare @param / rename), and pins a
 * stable rule_id for the dashboard.
 */
import type { Rule } from './engine';

const MSG_RE =
  /Unknown argument\s+['"`]([^'"`]+)['"`]\s+in\s+(?:render|function)\s+tag\s+for\s+(?:partial|target)\s+['"`]([^'"`]+)['"`]/i;

export const rules: Rule[] = [
  {
    id: 'UnrecognizedRenderPartialArguments.default',
    check: 'UnrecognizedRenderPartialArguments',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const m = (diag.message ?? '').match(MSG_RE);
      const argName = m?.[1] ?? null;
      const partialName = m?.[2] ?? null;

      // Module path → can't add an @param to a file we don't own; the only
      // valid edits are "drop the arg" or "rename to a declared @param".
      const isModulePartial = partialName?.startsWith('modules/');

      const argSpan = argName ? `\`${argName}\`` : 'the unrecognized argument';
      const partialSpan = partialName ? `\`${partialName}\`` : 'the target partial';

      const optionA =
        `Remove ${argSpan} from the calling tag in this file. ` +
        `If the partial doesn't read it, passing it is dead data.`;
      const optionB = isModulePartial
        ? `Skip — module partials are read-only; pick option A or C.`
        : `Add a matching \`@param\` declaration to ${partialSpan}'s \`{% doc %}\` block. ` +
          `Use this when the partial *should* consume the value.`;
      const optionC =
        `Rename ${argSpan} to match a declared \`@param\` name. ` +
        `Use this when the argument was a typo.`;

      const hint =
        `${argSpan} passed to ${partialSpan} is not declared in its \`{% doc %}\` block — ` +
        `\`@param\` is the contract and undeclared arguments are silently dropped at render time.\n\n` +
        `Pick one fix:\n` +
        `  A) ${optionA}\n` +
        `  B) ${optionB}\n` +
        `  C) ${optionC}`;

      const fixDescription = isModulePartial
        ? `Remove ${argSpan} from the calling tag, OR rename it to match a declared ` +
          `\`@param\` of ${partialSpan}. Module partials are read-only — option B (add @param) is unavailable.`
        : `Pick one: (A) drop ${argSpan} from the call site, (B) declare ${argSpan} as ` +
          `\`@param\` in ${partialSpan}'s \`{% doc %}\` block, or (C) rename to a declared @param.`;

      return {
        rule_id: 'UnrecognizedRenderPartialArguments.default',
        hint_md: hint,
        fixes: [{ type: 'guidance', description: fixDescription }],
        confidence: 0.85,
      };
    },
  },
];
