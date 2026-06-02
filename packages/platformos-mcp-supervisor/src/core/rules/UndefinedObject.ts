/**
 * UndefinedObject rules — variable not defined in current scope.
 *
 * Priority order:
 *    10 — shopify_object:   Shopify theme object detected → migration guidance
 *    20 — context_prefix:   bare variable in page needs context. prefix
 *    30 — declare_param:    partial/command/query needs @param declaration
 *   100 — generic:          variable name extracted but no specialised rule applies
 *  1000 — default:          catch-all for the case where extraction failed
 *         (LSP message shape change, etc.). Without this rule the diagnostic
 *         would land as `UndefinedObject.unmatched`. Confidence is intentionally
 *         lower than `.generic` so analytics treat it as a coverage signal, not
 *         an authoritative answer.
 */
import type { Rule, RuleFix } from './engine';
import { isShopifyObject, getShopifyObject, getCheckKnowledge } from '../knowledge-loader';

const CONTEXT_PROPS = ['params', 'session', 'current_user', 'page', 'location', 'environment', 'authenticity_token', 'headers', 'constants'];

export const rules: Rule[] = [
  {
    id: 'UndefinedObject.shopify_object',
    check: 'UndefinedObject',
    priority: 10,
    when: (diag) => {
      const name = diag.params?.variable;
      return !!name && isShopifyObject(name);
    },
    apply: (diag) => {
      const params = diag.params!;
      const name = params.variable;
      const info = getShopifyObject(name);
      const suggestion = info?.replacement
        ? `\`${name}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
        : `\`${name}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;

      const kb = getCheckKnowledge('UndefinedObject', 'default');

      const fixes: RuleFix[] = [];
      if (info?.replacement) {
        fixes.push({
          type: 'text_edit',
          range: {
            start: { line: diag.line ?? 0, character: diag.column ?? 0 },
            end: { line: diag.line ?? 0, character: (diag.column ?? 0) + name.length },
          },
          new_text: info.replacement,
          description: `Replace Shopify object \`${name}\` with \`${info.replacement}\``,
        });
      } else {
        fixes.push({
          type: 'guidance',
          description: `\`${name}\` is a Shopify theme object. Use \`{% graphql %}\` to fetch data and \`context.*\` for request/user data.`,
        });
      }

      return {
        rule_id: 'UndefinedObject.shopify_object',
        hint_md: `${kb?.shopify_guidance ?? suggestion}\n\n${suggestion}`,
        suggestion,
        fixes,
        confidence: 0.95,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'pages', section: 'gotchas' },
          reason: `Shopify object \`${name}\` detected — platformOS uses different patterns for data access.`,
        },
      };
    },
  },

  {
    id: 'UndefinedObject.context_prefix',
    check: 'UndefinedObject',
    priority: 20,
    when: (diag) => {
      const name = diag.params?.variable;
      if (!name) return false;
      const isPage = diag.file && /\/pages\//.test(diag.file);
      if (!isPage) return false;
      return CONTEXT_PROPS.includes(name);
    },
    apply: (diag) => {
      const params = diag.params!;
      const name = params.variable;
      return {
        rule_id: 'UndefinedObject.context_prefix',
        hint_md: `Use \`context.${name}\` instead of bare \`${name}\`. In pages, all built-in objects require the \`context.\` prefix: \`context.params\`, \`context.session\`, \`context.current_user\`, \`context.page\`.`,
        fixes: [{
          type: 'text_edit',
          range: {
            start: { line: diag.line ?? 0, character: diag.column ?? 0 },
            end: { line: diag.line ?? 0, character: (diag.column ?? 0) + name.length },
          },
          new_text: `context.${name}`,
          description: `Replace \`${name}\` with \`context.${name}\``,
        }],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'UndefinedObject.declare_param',
    check: 'UndefinedObject',
    priority: 30,
    when: (diag) => {
      const name = diag.params?.variable;
      if (!name) return false;
      const isPartial = diag.file && /\/partials\/|\/commands\/|\/queries\//.test(diag.file);
      return isPartial;
    },
    apply: (diag) => {
      const params = diag.params!;
      const name = params.variable;
      const isCommand = diag.file && /\/commands\//.test(diag.file);
      const isQuery = diag.file && /\/queries\//.test(diag.file);
      const fileType = isCommand ? 'command' : isQuery ? 'query' : 'partial';

      return {
        rule_id: 'UndefinedObject.declare_param',
        hint_md: `Variable \`${name}\` is not defined. In ${fileType}s, all variables must be passed explicitly. Add a \`{% doc %}\` block: \`{% doc %} @param {object} ${name} {% enddoc %}\` and pass it from the caller.`,
        fixes: [{
          type: 'insert',
          position: { line: 0, character: 0 },
          text: `{% doc %}\n  @param {object} ${name}\n{% enddoc %}\n`,
          description: `Add \`@param {object} ${name}\` declaration in a {% doc %} block at the top of the file`,
        }],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'UndefinedObject.generic',
    check: 'UndefinedObject',
    priority: 100,
    when: (diag) => !!diag.params?.variable,
    apply: (diag) => {
      // By the time this rule runs, .context_prefix (priority 20) has
      // already failed — i.e. the variable is NOT in the known context-props
      // shortlist (params, session, current_user, page, location, environment,
      // authenticity_token, headers, constants). The previous hint still
      // suggested `context.X` in this branch, which sent agents down a
      // regression spiral: applying `context.X` for an unknown X yields a
      // fresh UnknownProperty diagnostic, not a fix. Measured 2/2 regressions
      // on `app/views/pages/index.liquid` in DEMO (2026-04). The hint below
      // names the real legitimate sources for the file's domain instead.
      const params = diag.params!;
      const name = params.variable;
      const isPage = !!diag.file && /\/pages\//.test(diag.file);
      const isLayout = !!diag.file && /\/layouts\//.test(diag.file);

      let hint: string;
      if (isPage) {
        hint =
          `Variable \`${name}\` is not defined. \`${name}\` is NOT a built-in context object — ` +
          `\`context.\` only namespaces a fixed shortlist (\`params\`, \`session\`, \`current_user\`, ` +
          `\`page\`, \`location\`, \`environment\`, \`authenticity_token\`, \`headers\`, \`constants\`). ` +
          `Adding \`context.${name}\` would create a fresh \`UnknownProperty\` error. Pick one source:\n` +
          `  • **URL / form param** → \`context.params.${name}\`.\n` +
          `  • **Database** → \`{% graphql ${name} = '<op_name>' %}\` first, then access via \`${name}.records\`.\n` +
          `  • **Module helper** → \`{% function ${name} = '<lib/path>' %}\`.\n` +
          `  • **Computed locally** → \`{% assign ${name} = <expression> %}\` before the use site.\n` +
          `  • **Forwarded by layout** → declare it in the page with \`{% content_for '${name}' %}…{% endcontent_for %}\` ` +
          `and read in layout via \`{{ content_for.${name} }}\`.`;
      } else if (isLayout) {
        hint =
          `Variable \`${name}\` is not defined in the layout scope. Layouts can only see ` +
          `\`context.*\` (the same fixed shortlist as pages — \`${name}\` is not in it), ` +
          `\`{{ content_for_layout }}\`, named \`{{ content_for.* }}\` slots, or values assigned ` +
          `in the layout itself with \`{% assign %}\`. If the page should pass \`${name}\` down, ` +
          `the page emits \`{% content_for '${name}' %}…{% endcontent_for %}\` and the layout reads ` +
          `\`{{ content_for.${name} }}\`.`;
      } else {
        // Other surface (asset, partial that didn't match .declare_param,
        // command/query without a containing partial). Generic guidance —
        // explicitly NOT suggesting `context.${name}` since we know it's
        // not a context property.
        hint =
          `Variable \`${name}\` is not defined in the current scope. Ensure it's assigned ` +
          `before use with \`{% assign %}\`, \`{% graphql %}\`, or \`{% function %}\`. ` +
          `In partials / commands / queries, declare it as a \`{% doc %} @param {<type>} ${name} {% enddoc %}\` ` +
          `and pass it from the caller.`;
      }

      return {
        rule_id: 'UndefinedObject.generic',
        hint_md: hint,
        fixes: [],
        confidence: 0.5,
      };
    },
  },

  // Last-resort catch-all. Reached only when `.generic`'s extraction guard
  // failed — the LSP emitted an UndefinedObject whose message did not match
  // the documented shape. Surfaces a diagnostic that names "an undefined
  // variable" without pretending we know which one.
  {
    id: 'UndefinedObject.default',
    check: 'UndefinedObject',
    priority: 1000,
    when: () => true,
    apply: () => ({
      rule_id: 'UndefinedObject.default',
      hint_md:
        `An undefined variable is referenced. Read the upstream message — it names the variable. ` +
        `Three canonical resolutions:\n` +
        `  • **In a page** — bare names like \`params\`, \`session\`, \`current_user\` need ` +
        `the \`context.\` prefix.\n` +
        `  • **In a partial / command / query** — declare the variable as a \`{% doc %} ` +
        `@param {<type>} <name> {% enddoc %}\` and have the caller pass it.\n` +
        `  • **Local computation** — assign before use: \`{% assign x = ... %}\` / ` +
        `\`{% graphql x = ... %}\` / \`{% function x = ... %}\`.`,
      fixes: [{
        type: 'guidance',
        description:
          `Re-read the upstream message for the variable name, then either prefix with \`context.\`, ` +
          `declare as a \`@param\`, or assign before use depending on where the reference lives.`,
      }],
      confidence: 0.4,
    }),
  },
];
