/**
 * UnknownFilter rules — filter does not exist in platformOS Liquid.
 *
 * Priority order:
 *    10 — tag_confusion:   filter name is actually a tag
 *    20 — shopify_filter:  Shopify-specific filter detected
 *    30 — suggest_nearest: did-you-mean via filters index
 *   100 — generic:         filter name extracted but no specialised rule applies
 *  1000 — default:         catch-all for the case where extraction failed.
 *         Stops the diagnostic from landing as `UnknownFilter.unmatched` and
 *         gives the agent a typed hint regardless of upstream message shape.
 */
import type { Rule, RuleFix } from './engine';
import { isShopifyFilter, getShopifyFilter } from '../knowledge-loader';

export const rules: Rule[] = [
  {
    id: 'UnknownFilter.tag_confusion',
    check: 'UnknownFilter',
    priority: 10,
    when: (diag, facts) => {
      const name = diag.params?.filter;
      return !!name && !!facts.tagsIndex?.isTag(name);
    },
    apply: (diag) => {
      const params = diag.params!;
      const name = params.filter;
      return {
        rule_id: 'UnknownFilter.tag_confusion',
        hint_md: `\`${name}\` is a tag, not a filter. Use \`{% ${name} ... %}\` instead of \`| ${name}\`.`,
        fixes: [
          {
            type: 'guidance',
            description: `Replace \`| ${name}\` with block syntax \`{% ${name} ... %}\`. This is a structural change — the filter pipe must become a tag block.`,
          },
        ],
        confidence: 0.95,
      };
    },
  },

  {
    id: 'UnknownFilter.shopify_filter',
    check: 'UnknownFilter',
    priority: 20,
    when: (diag) => {
      const name = diag.params?.filter;
      return !!name && isShopifyFilter(name);
    },
    apply: (diag) => {
      const params = diag.params!;
      const name = params.filter;
      const info = getShopifyFilter(name);
      const suggestion = info?.replacement
        ? `\`${name}\` is a Shopify filter — not in platformOS. Use \`${info.replacement}\` instead.${info.note ? ` ${info.note}` : ''}`
        : `\`${name}\` is a Shopify-specific filter — not in platformOS.${info?.note ? ` ${info.note}` : ''}`;

      const fixes: RuleFix[] = [];
      if (info?.replacement) {
        fixes.push({
          type: 'text_edit',
          range: {
            start: { line: diag.line ?? 0, character: diag.column ?? 0 },
            end: { line: diag.line ?? 0, character: (diag.column ?? 0) + name.length },
          },
          new_text: info.replacement,
          description: `Replace Shopify filter \`${name}\` with platformOS equivalent \`${info.replacement}\``,
        });
      } else {
        fixes.push({
          type: 'guidance',
          description: `\`${name}\` is Shopify-specific. Check platformOS docs for equivalent functionality.`,
        });
      }

      return {
        rule_id: 'UnknownFilter.shopify_filter',
        hint_md: suggestion,
        suggestion,
        fixes,
        confidence: 0.9,
        see_also: {
          tool: 'lookup',
          args: { mode: 'completions' },
          reason: `Use lookup (completions mode) at the filter position to see available platformOS filters.`,
        },
      };
    },
  },

  {
    id: 'UnknownFilter.suggest_nearest',
    check: 'UnknownFilter',
    priority: 30,
    when: (diag, facts) => {
      const name = diag.params?.filter;
      return !!name && !!facts.filtersIndex?.loaded;
    },
    apply: (diag, facts) => {
      const params = diag.params!;
      const name = params.filter;
      const exact = facts.filtersIndex!.lookup(name);
      if (exact) {
        return {
          rule_id: 'UnknownFilter.suggest_nearest',
          hint_md: `Filter \`${exact.name}\` exists: ${exact.syntax || exact.summary}`,
          fixes: [],
          confidence: 0.8,
        };
      }
      const closest = facts.filtersIndex!.closestMatch(name);
      if (closest) {
        return {
          rule_id: 'UnknownFilter.suggest_nearest',
          hint_md: `Did you mean \`${closest.name}\`? ${closest.syntax || closest.summary}`,
          fixes: [
            {
              type: 'text_edit',
              range: {
                start: { line: diag.line ?? 0, character: diag.column ?? 0 },
                end: { line: diag.line ?? 0, character: (diag.column ?? 0) + name.length },
              },
              new_text: closest.name,
              description: `Replace \`${name}\` with \`${closest.name}\``,
            },
          ],
          confidence: 0.6,
        };
      }
      return null;
    },
  },

  {
    id: 'UnknownFilter.generic',
    check: 'UnknownFilter',
    priority: 100,
    when: (diag) => !!diag.params?.filter,
    apply: (diag) => {
      const params = diag.params!;
      const name = params.filter;
      return {
        rule_id: 'UnknownFilter.generic',
        hint_md: `Filter \`${name}\` is not available in platformOS. Check for typos or use \`lookup\` (completions mode) at the filter position to see available filters.`,
        fixes: [],
        confidence: 0.4,
      };
    },
  },

  // Last-resort catch-all. Reached only when `.generic`'s extraction guard
  // failed — the LSP emitted an UnknownFilter whose message did not match
  // the documented "Unknown filter '<name>'" shape. Hint stays generic but
  // is enough to direct the agent at the lookup tool and the
  // platformOS-vs-Shopify distinction.
  {
    id: 'UnknownFilter.default',
    check: 'UnknownFilter',
    priority: 1000,
    when: () => true,
    apply: () => ({
      rule_id: 'UnknownFilter.default',
      hint_md:
        `An unknown filter is referenced. Read the upstream message — it names the filter. ` +
        `Two canonical resolutions:\n` +
        `  • **Typo** — fix the filter name. Use \`lookup\` (completions mode) at the filter position ` +
        `to see what platformOS actually ships.\n` +
        `  • **Shopify-only filter** — platformOS does not have Shopify's \`money\`, \`img_url\`, ` +
        `\`link_to\` family. Replace with the platformOS equivalent or restructure the template.\n\n` +
        `Tags and filters are syntactically distinct: \`{% tag ... %}\` vs \`| filter\`. ` +
        `If the name is actually a tag, switch to block syntax.`,
      fixes: [
        {
          type: 'guidance',
          description:
            `Re-read the upstream message for the filter name, then look it up via \`lookup\` ` +
            `(completions mode) at the filter position. If it's Shopify-specific, find the ` +
            `platformOS equivalent or rewrite the expression.`,
        },
      ],
      confidence: 0.4,
    }),
  },
];
