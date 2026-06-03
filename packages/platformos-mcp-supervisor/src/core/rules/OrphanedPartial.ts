/**
 * OrphanedPartial rule — partial files that aren't rendered by anything
 * else in the project graph.
 *
 * Pre-rule the check landed as `.unmatched`. The diagnostic-pipeline already
 * suppresses commands/queries (invoked via `function`, not `render`) and
 * pending-plan files via `suppressOrphanedPartial` upstream of this rule, so
 * by the time we see one it's a real orphan in `app/views/partials/`.
 *
 * Two distinct intents → two recommendations:
 *   • The file is dead code → delete it (high-confidence delete_file fix when
 *     `referencedBy(file)` is empty in the graph).
 *   • The file is mid-development and the caller hasn't been written yet →
 *     pass `pending_files=[…callerPath]` to validate_code, or just write the
 *     caller now. The hint surfaces this option so agents don't blindly
 *     delete in-progress work.
 *
 * No fix when `diag.file` is missing — without the path we can't tell which
 * file to act on.
 */

import type { Rule, RuleFix } from './engine';
import { dependentsOf, classifyFileType } from './queries';

export const rules: Rule[] = [
  {
    id: 'OrphanedPartial.default',
    check: 'OrphanedPartial',
    priority: 100,
    when: () => true,
    apply: (diag, facts) => {
      const file = diag.file ?? null;
      const fileType = file ? classifyFileType(file) : 'unknown';
      const callers = file && facts?.graph ? dependentsOf(facts.graph, file) : [];
      const callerCount = callers.length;
      const filenameSpan = file ? `\`${file}\`` : 'this partial';

      // The diagnostic-pipeline's `suppressOrphanedPartial` already drops
      // commands/queries — by the time we see one, it should be a real
      // partial. Belt-and-suspenders: if a non-partial slips through, give
      // a softer "verify caller graph" message instead of a delete proposal.
      const isPartial = fileType === 'partial';
      const isLayout = fileType === 'layout';

      const fixes: RuleFix[] = [];
      if (isPartial && callerCount === 0) {
        fixes.push({
          type: 'delete_file',
          path: file,
          description:
            `Delete ${filenameSpan} — no other file in the project renders it. ` +
            `Re-run validate_code first if you're mid-feature; pass ` +
            `\`pending_files=["${file}"]\` (or the caller's path) to suppress this warning while you write the caller.`,
        });
      }
      fixes.push({
        type: 'guidance',
        description: orphanGuidance(filenameSpan, isPartial, isLayout),
      });

      return {
        rule_id: 'OrphanedPartial.default',
        hint_md: orphanHint(filenameSpan, callerCount, isPartial, isLayout),
        fixes,
        confidence: isPartial && callerCount === 0 ? 0.85 : 0.6,
      };
    },
  },
];

function orphanHint(
  filenameSpan: string,
  callerCount: number,
  isPartial: boolean,
  isLayout: boolean,
): string {
  if (isLayout) {
    return (
      `${filenameSpan} is a layout with no pages selecting it via \`layout: <name>\`. ` +
      `Either select it from a page (\`---\\nlayout: ${filenameSpan
        .replace(/`/g, '')
        .replace(/.*\//, '')
        .replace(/\.liquid$/, '')}\\n---\`) ` +
      `or delete the layout if it's no longer needed. Pages without a \`layout:\` key ` +
      `default to \`application.liquid\`.`
    );
  }
  if (!isPartial) {
    return (
      `${filenameSpan} appears to be unreferenced, but the file isn't a regular partial — ` +
      `verify caller graph manually with \`platformos_references\` before deleting. ` +
      `Commands and queries are invoked via \`{% function %}\` and may not always show up as ` +
      `dependencies in the rendering graph.`
    );
  }
  const callerNote =
    callerCount === 0
      ? 'No file in the project renders or includes it.'
      : `Found ${callerCount} caller(s) outside the standard render graph — verify with \`platformos_references\`.`;
  return (
    `${filenameSpan} is an orphaned partial. ${callerNote}\n\n` +
    `Two valid resolutions:\n` +
    `  • **Dead code** — delete the file. Use the \`delete_file\` fix if you're certain nothing renders it.\n` +
    `  • **Work in progress** — the caller hasn't been written yet. Either write the caller now ` +
    `(then re-validate, the warning clears), or pass \`pending_files=["<caller-path>"]\` to ` +
    `validate_code so the orphan is suppressed during the multi-file plan.\n\n` +
    `Renaming the file (e.g. via scaffold output) is the third common cause — re-run ` +
    `\`project_map\` to confirm callers point at the current name.`
  );
}

function orphanGuidance(filenameSpan: string, isPartial: boolean, isLayout: boolean): string {
  if (isLayout) {
    return (
      `Either set \`layout: <name>\` in a page's front matter to use ${filenameSpan}, or delete the file ` +
      `if it's no longer needed. Pages without an explicit \`layout:\` use \`application.liquid\`.`
    );
  }
  if (!isPartial) {
    return (
      `Run \`platformos_references\` to enumerate every file that references ${filenameSpan}. ` +
      `Commands/queries invoked via \`{% function %}\` may be missed by the render-graph orphan check.`
    );
  }
  return (
    `Decide: (a) delete ${filenameSpan} if it's dead, (b) write the calling page/partial if work is in progress, ` +
    `or (c) pass \`pending_files=["<caller>"]\` to validate_code while you scaffold the caller. ` +
    `Run \`platformos_references\` to confirm no rendering graph entry points at it.`
  );
}
