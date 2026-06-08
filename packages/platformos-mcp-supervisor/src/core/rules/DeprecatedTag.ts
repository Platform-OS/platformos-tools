/**
 * DeprecatedTag rules — both the upstream LSP `DeprecatedTag` check (emitted
 * by pos-cli for `{% include %}`, `{% parse_json %}`, etc.) AND the
 * pos-supervisor structural variant `pos-supervisor:DeprecatedTag` (raised
 * by `structural-warnings.detectDeprecatedTags` when the upstream check is
 * silent for a tag we still want flagged).
 *
 * Rule_id pinning: every emit of either check now lands as
 * `DeprecatedTag.<tag>` (or `.default`) in analytics. Before this module both
 * checks were `*.unmatched`, so adoption + regression rates were collapsed
 * across very different tags (`include` is ~100 % auto-fixable, `hash_assign`
 * needs careful per-line edits, `parse_json` needs filter-syntax migration).
 *
 * Fix policy:
 *   - `include`     → `text_edit` is owned by `ConvertIncludeToRender` (different
 *                     check name, sibling rule). The deprecated-tag rule
 *                     emits `guidance` only — duplicating the rename here
 *                     would compete with that module.
 *   - `hash_assign` → fix-generator's `fixDeprecatedTag` produces a
 *                     `hash_assign` → `assign` literal text_edit. We emit
 *                     `guidance` so it isn't a duplicate; the heuristic
 *                     edit complements the explanation.
 *   - `parse_json`  → no live text_edit yet (the `| parse_json` filter form
 *                     is structural, not a single-token swap). `guidance`
 *                     plus an explicit migration recipe is the best signal
 *                     short of an AST rewrite.
 *   - default       → fallback for any other deprecated tag the upstream
 *                     adds in future without a dedicated subrule.
 */
import type { Rule } from './engine';

function ruleIdPrefix(checkName: string): string {
  // `pos-supervisor:DeprecatedTag` → rule_id starts with the bare check name
  // so analytics aggregation across the upstream + structural variants stays
  // readable. Storing rule_id as `pos-supervisor:DeprecatedTag.include` would
  // break a couple of dashboard regexes that strip the colon segment.
  return checkName.replace(/^pos-supervisor:/, '');
}

function rulesForCheck(checkName: string): Rule[] {
  return [
    {
      id: `${ruleIdPrefix(checkName)}.include`,
      check: checkName,
      priority: 10,
      when: (diag) =>
        /\binclude\b/.test(diag.params?.tag ?? '') || /\binclude\b/.test(diag.message ?? ''),
      apply: () => ({
        rule_id: `${ruleIdPrefix(checkName)}.include`,
        hint_md:
          '`{% include %}` is deprecated. Replace with `{% render %}` everywhere in this file. ' +
          '`{% render %}` has **isolated scope** — variables from the parent are NOT inherited; ' +
          "pass each one explicitly: `{% render 'partial', name: name, items: items %}`. " +
          'Exception: includes that pull in a module helper meant to share scope (auth, redirects) — ' +
          'leave those alone; the heuristic fix-generator detects this pattern and proposes guidance ' +
          'instead of a rename.',
        fixes: [
          {
            type: 'guidance',
            description:
              "Rename every `{% include 'X' %}` in this file to `{% render 'X', <vars> %}`. " +
              "List the partial's declared `@param` names and pass each explicitly — " +
              'isolated scope means undeclared vars come through as `nil`.',
          },
        ],
        confidence: 0.95,
      }),
    },

    {
      id: `${ruleIdPrefix(checkName)}.hash_assign`,
      check: checkName,
      priority: 10,
      when: (diag) =>
        /hash_assign/.test(diag.params?.tag ?? '') || /\bhash_assign\b/.test(diag.message ?? ''),
      apply: () => ({
        rule_id: `${ruleIdPrefix(checkName)}.hash_assign`,
        hint_md:
          '`{% hash_assign x, key: value %}` is deprecated. Use the bracket-assign form ' +
          '`{% assign x["key"] = value %}` (or dot form `{% assign x.key = value %}` for ' +
          'identifier keys). Both produce the same hash — the new form is plain `assign`.',
        fixes: [
          {
            type: 'guidance',
            description:
              'Replace `{% hash_assign x, key: value %}` with `{% assign x["key"] = value %}`. ' +
              'For dotted identifiers: `{% assign x.key = value %}`. ' +
              'The heuristic fix-generator emits the literal `hash_assign` → `assign` text_edit; ' +
              'apply it then update the argument shape from `, key: value` to `["key"] = value`.',
          },
        ],
        confidence: 0.85,
      }),
    },

    {
      id: `${ruleIdPrefix(checkName)}.parse_json`,
      check: checkName,
      priority: 10,
      when: (diag) =>
        /parse_json/.test(diag.params?.tag ?? '') || /\bparse_json\b/.test(diag.message ?? ''),
      apply: () => ({
        rule_id: `${ruleIdPrefix(checkName)}.parse_json`,
        hint_md:
          '`{% parse_json x %}…{% endparse_json %}` is deprecated. Use the filter form ' +
          "`{% assign x = '<json>' | parse_json %}` (single-line) or build the literal with " +
          '`{% capture json %}…{% endcapture %}{% assign x = json | parse_json %}` for ' +
          'multi-line payloads. The filter is exact-equivalent semantically.',
        fixes: [
          {
            type: 'guidance',
            description:
              'Migrate `{% parse_json x %}{ … }{% endparse_json %}` to ' +
              "`{% assign x = '{ … }' | parse_json %}`. For multi-line payloads use " +
              '`{% capture body %}{ … }{% endcapture %}{% assign x = body | parse_json %}` so the ' +
              'JSON is left literal — `parse_json` accepts strings, not block contents.',
          },
        ],
        confidence: 0.85,
      }),
    },

    {
      id: `${ruleIdPrefix(checkName)}.default`,
      check: checkName,
      priority: 100,
      when: () => true,
      apply: (diag) => {
        const tag = diag.params?.tag ?? null;
        const replacement = diag.params?.replacement ?? null;
        const tagSpan = tag ? `\`{% ${tag} %}\`` : 'this tag';
        const replSpan = replacement ? `Use \`{% ${replacement} %}\` instead.` : '';
        return {
          rule_id: `${ruleIdPrefix(checkName)}.default`,
          hint_md:
            `${tagSpan} is deprecated in platformOS. ${replSpan} ` +
            `Read the upstream message — it usually names the replacement and behavioral changes ` +
            `(e.g. isolated scope for \`render\`). Fix every occurrence in this file in one pass; ` +
            `leaving a single instance re-fires the check on the next write.`,
          fixes: [],
          confidence: 0.7,
        };
      },
    },
  ];
}

export const rules: Rule[] = [
  ...rulesForCheck('DeprecatedTag'),
  ...rulesForCheck('pos-supervisor:DeprecatedTag'),
];
