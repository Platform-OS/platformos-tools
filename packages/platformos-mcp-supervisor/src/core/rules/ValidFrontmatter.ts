/**
 * ValidFrontmatter rules — pos-cli 6.0.7 frontmatter schema validator.
 *
 * The upstream check emits 8 distinct shapes (see EXTRACTORS in
 * `core/diagnostic-record.js`). Each shape has a category-specific rule with
 * an action-oriented hint. A `.fallback` rule covers the unknown shape so
 * every emit gets a stable rule_id (no `.unmatched` rows in analytics).
 *
 * Phase 2 dedup (suppressUpstreamFrontmatterDup) drops the layout-missing and
 * unknown-field shapes when they collide line-for-line with our richer
 * pos-supervisor:* counterparts. Surviving emits are NOVEL coverage —
 * the rules below add the missing context the agent needs to act.
 *
 * Confidence rationale:
 *   - Categorical rules where upstream gives an unambiguous fix (layout_false)
 *     ride at 0.9.
 *   - Categories that name a field but require human judgment (unknown_field,
 *     missing_required, invalid_enum, deprecated_field, association_missing,
 *     layout_missing, home_deprecated) ride at 0.85.
 *   - Fallback (unknown shape) rides at 0.5 — we don't know what fired, so
 *     the agent should not over-trust the hint.
 */
import type { Rule } from './engine';

function fmtField(params: Record<string, string> | undefined): string {
  return params?.field ? `\`${params.field}\`` : 'the offending key';
}

export const rules: Rule[] = [
  {
    id: 'ValidFrontmatter.home_deprecated',
    check: 'ValidFrontmatter',
    priority: 10,
    when: (diag) => diag.params?.category === 'home_deprecated',
    apply: () => ({
      rule_id: 'ValidFrontmatter.home_deprecated',
      hint_md: '`home.html.liquid` is deprecated. Rename to `index.html.liquid` to serve as the root page. Update any cross-references (renders, redirects) afterwards.',
      fixes: [{
        type: 'guidance',
        description: 'Rename the file from `home.html.liquid` to `index.html.liquid` and update any links/redirects pointing at it.',
      }],
      confidence: 0.85,
    }),
  },

  {
    id: 'ValidFrontmatter.missing_required',
    check: 'ValidFrontmatter',
    priority: 20,
    when: (diag) => diag.params?.category === 'missing_required',
    apply: (diag) => {
      const params = diag.params!;
      const field = fmtField(params);
      const fileType = params.file_type ?? 'this';
      return {
        rule_id: 'ValidFrontmatter.missing_required',
        hint_md: `${field} is required for a ${fileType} file. Add it to the frontmatter block (between the leading and trailing \`---\`). \`scaffold\` produces the correct frontmatter for ${fileType} files when generating from a feature spec.`,
        fixes: [{
          type: 'guidance',
          description: `Add ${field} to the frontmatter. Refer to the ${fileType} domain guide via \`domain_guide\` for the expected shape.`,
        }],
        confidence: 0.85,
        see_also: {
          tool: 'domain_guide',
          args: { domain: (params.file_type ?? '').toLowerCase() || 'pages' },
          reason: `Required-field shapes vary per file type. domain_guide for ${fileType} lists the canonical frontmatter.`,
        },
      };
    },
  },

  {
    id: 'ValidFrontmatter.unknown_field',
    check: 'ValidFrontmatter',
    priority: 30,
    when: (diag) => diag.params?.category === 'unknown_field',
    apply: (diag) => {
      const params = diag.params!;
      const field = fmtField(params);
      const fileType = params.file_type ?? 'this';
      return {
        rule_id: 'ValidFrontmatter.unknown_field',
        hint_md: `${field} is not a valid frontmatter key for ${fileType} files. Common causes: typo (compare with the field list in \`domain_guide\`), wrong file type (this key may belong on a different file), or a leftover from another framework. Remove the key or move the value into the right shape.`,
        fixes: [{
          type: 'guidance',
          description: `Remove ${field} from the frontmatter, or replace it with the correct platformOS key. Consult \`domain_guide\` for the valid frontmatter keys per file type.`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'ValidFrontmatter.deprecated_field',
    check: 'ValidFrontmatter',
    priority: 40,
    when: (diag) => diag.params?.category === 'deprecated_field',
    apply: (diag) => {
      const field = fmtField(diag.params);
      return {
        rule_id: 'ValidFrontmatter.deprecated_field',
        hint_md: `${field} is deprecated. The upstream message names the replacement (e.g. \`layout_name\` → \`layout\`, \`layout_path\` → \`layout\`). Rename in place; the value semantics are preserved.`,
        fixes: [{
          type: 'guidance',
          description: `Rename ${field} to its modern equivalent per the deprecation message. Don't remove the value — just change the key.`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'ValidFrontmatter.invalid_enum',
    check: 'ValidFrontmatter',
    priority: 50,
    when: (diag) => diag.params?.category === 'invalid_enum',
    apply: (diag) => {
      const params = diag.params!;
      const field = fmtField(params);
      const value = params.value ? `\`${params.value}\`` : 'the supplied value';
      const allowed = params.allowed ?? '(see message)';
      // Method comparison is case-insensitive in the upstream check, so an
      // uppercase HTTP method like `POST` will be flagged. Surface the
      // canonical lowercase variant when the value matches an allowed token
      // case-insensitively.
      const lowerValue = (params.value ?? '').toLowerCase();
      const allowedTokens = allowed.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const canonical = allowedTokens.find((t) => t.toLowerCase() === lowerValue);
      const guidance = canonical
        ? `Replace ${value} with \`${canonical}\` — same value, just the canonical case.`
        : `Replace ${value} with one of: ${allowed}.`;
      return {
        rule_id: 'ValidFrontmatter.invalid_enum',
        hint_md: `${value} is not a valid value for ${field}. Allowed: ${allowed}. ${guidance}`,
        fixes: [{
          type: 'guidance',
          description: guidance,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'ValidFrontmatter.layout_false',
    check: 'ValidFrontmatter',
    priority: 60,
    when: (diag) => diag.params?.category === 'layout_false',
    apply: () => ({
      rule_id: 'ValidFrontmatter.layout_false',
      hint_md: '`layout: false` does NOT disable the layout — YAML parses `false` as boolean and platformOS falls back to the default layout. Use `layout: \'\'` (empty string) to render the page without a layout.',
      fixes: [{
        type: 'guidance',
        description: "Replace `layout: false` with `layout: ''` (empty single-quoted string). This is the supported way to opt out of layout rendering.",
      }],
      confidence: 0.9,
    }),
  },

  {
    id: 'ValidFrontmatter.layout_missing',
    check: 'ValidFrontmatter',
    priority: 70,
    when: (diag) => diag.params?.category === 'layout_missing',
    apply: (diag) => {
      const params = diag.params!;
      const layout = params.layout ?? '(unnamed)';
      const expected = layout.startsWith('modules/')
        ? `modules/${layout.split('/')[1]}/public/views/layouts/${layout.split('/').slice(2).join('/')}.{html.,}liquid`
        : `app/views/layouts/${layout}.{html.,}liquid`;
      return {
        rule_id: 'ValidFrontmatter.layout_missing',
        hint_md: `Layout \`${layout}\` was not found. Expected file path: \`${expected}\`. Either fix the layout name in the frontmatter or create the layout file (must include \`{{ content_for_layout }}\` to render the page body).`,
        fixes: [{
          type: 'guidance',
          description: `Verify spelling against existing layouts in \`app/views/layouts/\` (or modules' layout directories) — call \`project_map\` to enumerate. If the layout truly is missing, create it with a \`{{ content_for_layout }}\` placeholder.`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'ValidFrontmatter.association_missing',
    check: 'ValidFrontmatter',
    priority: 80,
    when: (diag) => diag.params?.category === 'association_missing',
    apply: (diag) => {
      const params = diag.params!;
      const label = params.label ?? 'Referenced file';
      const name = params.name ?? '(unnamed)';
      return {
        rule_id: 'ValidFrontmatter.association_missing',
        hint_md: `${label} \`${name}\` does not exist. Authorization policies live under \`app/authorization_policies/\`; email/SMS/API-call notifications under their respective dirs. Create the referenced file or fix the reference.`,
        fixes: [{
          type: 'guidance',
          description: `Verify the file path matches an existing ${label.toLowerCase()} or scaffold the missing one. Call \`project_map\` to see what exists.`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'ValidFrontmatter.fallback',
    check: 'ValidFrontmatter',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'ValidFrontmatter.fallback',
      hint_md: 'Frontmatter validation failed. Read the upstream message — it names the field and shape problem. Reference: `domain_guide` per file type, or `scaffold` to regenerate canonical frontmatter.',
      fixes: [],
      confidence: 0.5,
    }),
  },
];
