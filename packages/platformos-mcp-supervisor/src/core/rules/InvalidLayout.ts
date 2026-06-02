/**
 * pos-supervisor:InvalidLayout rule — page front-matter references a layout
 * that doesn't exist on disk.
 *
 * Pre-rule the check landed as `.unmatched` even though fix-generator's
 * `fixStructuralCheck` already produced a `create_file` proposal. Pre-task-4
 * the proposal hardcoded the `.html.liquid` extension which DOES NOT match
 * many projects (DEMO included) — agents accepted the fix, the file landed
 * at the wrong path, and the original error never resolved.
 *
 * Task 4 fixed the path in the structural emitter (it now embeds the right
 * extension via `detectLayoutExtension`) and made `extractLayoutPath`
 * lift the path verbatim from the message. This rule attaches stable
 * attribution + a guidance fix that explains the two valid resolutions
 * (rename the layout reference vs create the missing layout file).
 *
 * Pairs with `ValidFrontmatter.layout_missing` (upstream LSP). The dedup
 * pass `suppressUpstreamFrontmatterDup` drops the upstream copy so only
 * this rule fires per offending page.
 */
import type { Rule, RuleFix } from './engine';

const MSG_RE = /^Layout `([^`]+)` not found\. Expected file: `([^`]+)`\./;

export const rules: Rule[] = [
  {
    id: 'InvalidLayout.default',
    check: 'pos-supervisor:InvalidLayout',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const m = (diag.message ?? '').match(MSG_RE);
      const layoutName = m?.[1] ?? null;
      const expectedPath = m?.[2] ?? null;

      const layoutSpan = layoutName ? `\`${layoutName}\`` : 'the referenced layout';
      const pathSpan = expectedPath ? `\`${expectedPath}\`` : 'the expected layout file';

      const hint =
        `${layoutSpan} is not on disk. The structural emitter resolved the canonical path to ` +
        `${pathSpan} (extension picked to match the project's existing layouts).\n\n` +
        `Two resolutions:\n` +
        `  • **Layout reference is wrong** — fix \`layout: ${layoutName ?? '<name>'}\` in this page's ` +
        `front matter. Run \`project_map\` to see which layouts exist.\n` +
        `  • **Layout file is missing** — create ${pathSpan}. Every layout MUST contain ` +
        `\`{{ content_for_layout }}\` exactly once (and may add named \`{% yield 'name' %}\` slots).`;

      const fixes: RuleFix[] = expectedPath
        ? [{
            type: 'create_file',
            path: expectedPath,
            description:
              `Create ${pathSpan} with at least \`{{ content_for_layout }}\` so pages using ` +
              `\`layout: ${layoutName ?? '<name>'}\` render. Verify the layout name is intentional first — ` +
              `a typo in the page front matter is a more common cause than a genuinely missing layout.`,
          }]
        : [{
            type: 'guidance',
            description:
              `Either fix the layout name in the page's front matter, or create the layout file. ` +
              `Run \`project_map\` to see which layouts exist.`,
          }];

      return {
        rule_id: 'InvalidLayout.default',
        hint_md: hint,
        fixes,
        confidence: 0.85,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'layouts' },
          reason: 'Layout file conventions — required `{{ content_for_layout }}`, named yield slots, locations.',
        },
      };
    },
  },
];
