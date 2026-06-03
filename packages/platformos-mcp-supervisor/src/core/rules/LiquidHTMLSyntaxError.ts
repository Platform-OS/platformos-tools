/**
 * LiquidHTMLSyntaxError rules — pos-cli surfaces a varied set of parser
 * errors under one check name:
 *   - Unknown tag
 *   - For-loop argument shape mismatch
 *   - Missing `=` in graphql/function assigns (heuristic owns text_edit)
 *   - Inline array/hash literal in tag arguments
 *   - Unclosed Liquid block / mismatched quotes
 *
 * Pre-rule every emit landed as `.unmatched` even though the messages
 * carry a clear discriminator. The rule routes by message shape and emits
 * subrule-specific guidance so analytics distinguish the very different
 * resolution rates (unknown_tag at ~100 % vs nested array literal where the
 * agent often misreads the cause).
 *
 * Fix policy:
 *   - missing_assign — heuristic in fix-generator already produces a
 *     text_edit. Rule emits guidance; precedence drops the heuristic
 *     `guidance` if any (it isn't there in this branch).
 *   - All others — guidance only; no deterministic AST rewrite.
 */

import type { Rule } from './engine';
import { nearestByLevenshtein } from './queries';

export const rules: Rule[] = [
  {
    id: 'LiquidHTMLSyntaxError.unknown_tag',
    check: 'LiquidHTMLSyntaxError',
    priority: 5,
    when: (diag) => /Unknown tag/i.test(diag.message ?? ''),
    apply: (diag, facts) => {
      const m = (diag.message ?? '').match(/Unknown tag\s+['"`]?(\w+)['"`]?/i);
      const badTag = m?.[1] ?? null;
      const tagsIndex = facts?.tagsIndex;

      let didYouMean = '';
      if (badTag && tagsIndex?.platformOSTags) {
        const known = tagsIndex.platformOSTags().map((t) => t.name);
        const nearest = nearestByLevenshtein(badTag, known, 3);
        if (nearest.length > 0) {
          const list = nearest.map((n) => `\`{% ${n.name} %}\``).join(', ');
          didYouMean = ` Did you mean: ${list}?`;
        }
      }

      const tagSpan = badTag ? `\`{% ${badTag} %}\`` : 'this tag';
      return {
        rule_id: 'LiquidHTMLSyntaxError.unknown_tag',
        hint_md:
          `${tagSpan} is not a recognised Liquid tag in platformOS.${didYouMean}\n\n` +
          `Common causes: typo in the tag name, custom tag from another framework (Shopify Liquid extras ` +
          `like \`{% layout %}\`, \`{% schema %}\` are NOT supported), or a stale rename. ` +
          `If the tag is custom: platformOS does not support custom tags — restructure as a partial ` +
          `(\`{% render %}\`) or filter.`,
        fixes: [
          {
            type: 'guidance',
            description: badTag
              ? `Replace ${tagSpan} with the correct tag name (see suggestions in the hint), or ` +
                `restructure if it was a Shopify-only tag.`
              : `Read the upstream message — it names the unknown tag. Replace it with a valid platformOS ` +
                `tag or restructure the logic.`,
          },
        ],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'LiquidHTMLSyntaxError.for_loop_args',
    check: 'LiquidHTMLSyntaxError',
    priority: 10,
    when: (diag) => /Arguments must be provided in the format `for in/i.test(diag.message ?? ''),
    apply: (diag) => {
      const m = (diag.message ?? '').match(/Invalid\/Unknown arguments:\s*(.+)$/i);
      const badArgs = m?.[1]?.trim() ?? null;
      const argsSpan = badArgs ? `\`${badArgs}\`` : 'the offending argument(s)';
      return {
        rule_id: 'LiquidHTMLSyntaxError.for_loop_args',
        hint_md:
          `\`{% for %}\` arguments must follow the form ` +
          `\`for <var> in <array> [reversed] [limit:N] [offset:N]\`. ` +
          `${argsSpan} ${badArgs ? 'are' : 'is'} not a recognised positional or named argument.\n\n` +
          `Frequent root cause: a Liquid filter (\`| t\`, \`| split\`, etc.) appears INSIDE the ` +
          `\`for ... in ...\` clause. The Liquid parser does not accept filter pipelines in the loop ` +
          `header — assign the filtered value first, then iterate.\n\n` +
          `Wrong: \`{% for item in 'k' | t %}\`  Right: \`{% assign items = 'k' | t %}{% for item in items %}\`. ` +
          `Wrong: \`{% for word in str | split: ',' %}\`  Right: \`{% assign words = str | split: ',' %}{% for word in words %}\`.`,
        fixes: [
          {
            type: 'guidance',
            description:
              `Move the filter pipeline out of the \`for in <array>\` clause: ` +
              `\`{% assign items = <pipeline> %}\` first, then \`{% for item in items %}\`. ` +
              `For nested loops over translation arrays, see the TranslationKeyExists.array_index_misuse ` +
              `pattern.`,
          },
        ],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'LiquidHTMLSyntaxError.missing_assign',
    check: 'LiquidHTMLSyntaxError',
    priority: 15,
    when: (diag) =>
      /\{%\s*(?:graphql|function)/.test(diag.message ?? '') && /=/.test(diag.message ?? ''),
    apply: () => ({
      rule_id: 'LiquidHTMLSyntaxError.missing_assign',
      hint_md:
        '`{% graphql %}` and `{% function %}` require an assignment target. The syntax is ' +
        "`{% graphql result = 'query_name' %}` and `{% function result = 'path/to/helper', arg: val %}` — " +
        'the `result =` part captures the call output and is not optional.',
      fixes: [
        {
          type: 'guidance',
          description:
            'Add `<var> =` between the tag name and the call path. ' +
            "`{% graphql records = 'q' %}` / `{% function record = 'helper', x: 1 %}`. " +
            'fix-generator emits the literal text_edit for the missing-`=` shape — accept it.',
        },
      ],
      confidence: 0.9,
    }),
  },

  {
    id: 'LiquidHTMLSyntaxError.inline_literal',
    check: 'LiquidHTMLSyntaxError',
    priority: 20,
    when: (diag) =>
      /(?:array|hash|object|literal|inline)/i.test(diag.message ?? '') &&
      /\{%\s*(?:render|function|graphql)/.test(diag.message ?? ''),
    apply: () => ({
      rule_id: 'LiquidHTMLSyntaxError.inline_literal',
      hint_md:
        'Inline `[…]` array literals and `{ … }` hash literals are NOT accepted as tag arguments. ' +
        "Liquid's tag parser only takes named scalars and pre-assigned variables. Build the literal " +
        'in a preceding `{% assign %}` then pass the variable.\n\n' +
        "Wrong: `{% render 'p', items: [] %}`  Right: `{% assign items = [] %}{% render 'p', items: items %}`.",
      fixes: [
        {
          type: 'guidance',
          description:
            'Pre-assign the literal: `{% assign items = […] %}` (or `{% assign cfg = { … } %}` for hashes), ' +
            'then pass `items` (or `cfg`) by name in the render/function/graphql tag.',
        },
      ],
      confidence: 0.85,
    }),
  },

  {
    id: 'LiquidHTMLSyntaxError.default',
    check: 'LiquidHTMLSyntaxError',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'LiquidHTMLSyntaxError.default',
      hint_md:
        'Liquid parser error. Read the upstream message — it names the line and column. ' +
        'Common causes:\n' +
        '  • Unclosed block (`{% if %}` without `{% endif %}`, `{% for %}` without `{% endfor %}`).\n' +
        '  • Inside `{% liquid %}` blocks each statement is on its own line with NO delimiters.\n' +
        '  • Mismatched quotes — every `\'` and `"` must be paired on the same logical token.\n' +
        '  • HTML and Liquid syntax interleaved unsafely (e.g. `<div {% if cond %}class="x"{% endif %}>` ' +
        'is fine; `<div class="{% if cond %}x"{% endif %}>` is not).\n\n' +
        'Fix the FIRST reported error — later errors often cascade from it.',
      fixes: [],
      confidence: 0.5,
    }),
  },
];
