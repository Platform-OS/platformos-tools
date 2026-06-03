/**
 * UnusedDocParam rule — `@param X` declared in a `{% doc %}` block but
 * never referenced anywhere in the file body.
 *
 * Pre-rule the check landed as `.unmatched` (11 emits in DEMO, 60 %
 * resolve, 0 % regression). The pipeline's `suppressUnusedDocParams`
 * already handles the common false positive — params used only as named
 * args in `{% render %}` / `{% function %}` calls inside the same file.
 * Surviving emits are real cases where the declaration is dead inside
 * the body.
 *
 * Two valid resolutions, both contract-aware:
 *   • **Use** the param — reference `{{ X }}`, condition on it,
 *     forward to a render call, etc. Right when the declaration was
 *     intentional and the body just hasn't been written yet (mid-feature).
 *   • **Remove** the `@param X` line — turns the param into a no-op
 *     contract. CALLERS passing `X: Y` will then start hitting
 *     `UnrecognizedRenderPartialArguments`. Safe only when there are
 *     no callers (verify via `platformos_references`).
 *
 * No `text_edit`: removing a doc-block line is a contract change with
 * cross-file blast radius; the rule layer can't safely automate it.
 * The pipeline's `suppressUnusedDocParams` is the safe automation —
 * silencing the warning when the param is actually used outside the
 * body. This rule covers what survives: real dead declarations.
 */
import type { Rule } from './engine';
import { dependentsOf } from './queries';

export const rules: Rule[] = [
  {
    id: 'UnusedDocParam.default',
    check: 'UnusedDocParam',
    priority: 100,
    when: () => true,
    apply: (diag, facts) => {
      const param = diag.params?.param_name ?? null;
      const file = diag.file ?? null;
      const callers = file && facts.graph ? dependentsOf(facts.graph, file) : [];

      const paramSpan = param ? `\`${param}\`` : 'this @param';

      const hint =
        `${paramSpan} is declared in this file's \`{% doc %}\` block but never referenced in the body. ` +
        `The pipeline already suppresses the case where ${paramSpan} is used as a named argument in a ` +
        `\`{% render %}\` / \`{% function %}\` / \`{% graphql %}\` call inside this same file — so the ` +
        `surviving warning means the declaration is genuinely dead.\n\n` +
        `Two valid resolutions:\n` +
        `  A) **Use the param.** Reference \`{{ ${param ?? '<param>'} }}\` in the body, condition on it ` +
        `(\`{% if ${param ?? '<param>'} %}\`), forward it to a sibling render, etc. Right when the ` +
        `declaration was intentional and the body is mid-feature.\n` +
        `  B) **Remove the \`@param ${param ?? '<param>'}\` line** from the \`{% doc %}\` block. ` +
        `**Contract change** — every caller that passes \`${param ?? '<param>'}: ...\` will start firing ` +
        `\`UnrecognizedRenderPartialArguments\`. Safe only when there are no callers.\n\n` +
        callerNote(file, callers);

      const fixDescription =
        callers.length === 0 && param && file
          ? `No callers reference this file in the project graph — option B (remove \`@param ${param}\` ` +
            `from the \`{% doc %}\` block) is safe. Option A (use the param) is still appropriate when the ` +
            `declaration was intentional. Run \`platformos_references\` to double-check before deleting; the ` +
            `graph misses dynamic includes and module-side renders.`
          : `Pick A (use the param) or B (remove \`@param ${param ?? '<param>'}\`). ${callers.length > 0 ? `Be careful with B — ${callers.length} caller(s) reference this file. ` : ''}` +
            `Run \`platformos_references\` to enumerate every render/function call before changing the contract.`;

      return {
        rule_id: 'UnusedDocParam.default',
        hint_md: hint,
        fixes: [{ type: 'guidance', description: fixDescription }],
        // High confidence on the diagnosis, lower on which resolution
        // is right — we can't tell intent from one diagnostic alone.
        confidence: callers.length === 0 ? 0.8 : 0.65,
      };
    },
  },
];

function callerNote(file: string | null, callers: string[]): string {
  if (!file) {
    return (
      `Caller count unknown (no file path on the diagnostic). Run \`platformos_references\` before ` +
      `picking a resolution.`
    );
  }
  if (callers.length === 0) {
    return (
      `No callers found in the project graph. **Option B is the lower-risk path** — but the graph ` +
      `misses dynamic \`{% render %}\` strings (computed partial paths) and module-side calls, so ` +
      `verify with \`platformos_references\` before deleting.`
    );
  }
  return (
    `${callers.length} caller(s) reference this file. **Option B will break them** if any pass ` +
    `the param being removed. Run \`platformos_references\` to enumerate; pick A unless you've ` +
    `verified every caller drops the argument too.`
  );
}
