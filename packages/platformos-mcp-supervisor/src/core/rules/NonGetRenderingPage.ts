/**
 * NonGetRenderingPage rules — three distinct misconfigurations of page
 * `method:` / `format:` / form `action` per the 2026-04-27 gist analysis
 * (NonGetRenderingPageRule.md). The structural emitter
 * (`validatePageMethodAndForms` in structural-warnings.js) is the only
 * producer of `pos-supervisor:NonGetRenderingPage` and tags each emit with
 * a leading-clause discriminator the rule layer routes by.
 *
 * Subrule analytics IDs:
 *   • NonGetRenderingPage.api_renders_html  — API-pathed page (`/api/`,
 *     `/_/`, `/internal/`) is non-GET but emits HTML or omits `format: json`.
 *   • NonGetRenderingPage.html_on_post      — non-API page is non-GET but
 *     renders HTML; browser GETs return 404.
 *   • NonGetRenderingPage.get_form_target   — GET page hosts a
 *     `<form method="post" action="...">` whose action is not under an
 *     internal-API prefix and is not the page's own slug.
 *   • NonGetRenderingPage.default           — fallback for diagnostics that
 *     don't match any subrule discriminator (defensive — should not fire
 *     in practice once the emitter is in sync with this router).
 *
 * Each subrule emits a concrete `guidance` fix that names the right shape
 * to converge on. No `text_edit` here: the deterministic fix requires
 * cross-file changes (edit page front matter AND add an API endpoint AND
 * possibly rewrite the form attribute) which the rule layer can't compose
 * safely. Agents accept the guidance, then validate iteratively.
 */

import type { Rule, RuleDiagnostic, RuleFacts } from './engine';

const API_RENDERS_HTML_RE = /^API page \(slug `([^`]+)`\) has `method: (\w+)`/;
const HTML_ON_POST_RE = /^Page has `method: (\w+)` but renders HTML/;
const GET_FORM_TARGET_RE = /^Form on GET page posts to `([^`]+)`/;

export const rules: Rule[] = [
  {
    id: 'NonGetRenderingPage.api_renders_html',
    check: 'pos-supervisor:NonGetRenderingPage',
    priority: 5,
    when: (diag: RuleDiagnostic, _facts: RuleFacts) => API_RENDERS_HTML_RE.test(diag.message ?? ''),
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const m = (diag.message ?? '').match(API_RENDERS_HTML_RE);
      const slug = m?.[1] ?? '<slug>';
      const method = m?.[2] ?? 'post';
      return {
        rule_id: 'NonGetRenderingPage.api_renders_html',
        hint_md:
          `API page \`${slug}\` is set to \`method: ${method}\` but is configured to render HTML — ` +
          `either it carries a \`layout:\` / inline HTML, or it is missing \`format: json\`. ` +
          `Pages under \`/api/\`, \`/_/\`, or \`/internal/\` must respond with JSON; rendering HTML to ` +
          `a JSON-expecting client is a silent contract break.\n\n` +
          `Canonical shape:\n` +
          '```liquid\n' +
          `---\n` +
          `slug: ${slug.replace(/^\//, '')}\n` +
          `method: ${method}\n` +
          `format: json\n` +
          `---\n` +
          `{% graphql result = 'mutation_path', ...args %}\n` +
          `{{ result | json }}\n` +
          '```',
        fixes: [
          {
            type: 'guidance',
            description:
              `Add \`format: json\` to the front matter, drop any \`layout:\` line, and replace the body ` +
              `with a \`{% graphql %}\` call followed by \`{{ result | json }}\`. ` +
              `Keep \`method: ${method}\` so the verb still matches the form / fetch caller.`,
          },
        ],
        confidence: 0.9,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'api-calls' },
          reason:
            'API endpoint conventions in platformOS — JSON format, GraphQL bodies, no layout.',
        },
      };
    },
  },

  {
    id: 'NonGetRenderingPage.html_on_post',
    check: 'pos-supervisor:NonGetRenderingPage',
    priority: 10,
    when: (diag: RuleDiagnostic, _facts: RuleFacts) => HTML_ON_POST_RE.test(diag.message ?? ''),
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const m = (diag.message ?? '').match(HTML_ON_POST_RE);
      const method = m?.[1] ?? 'post';
      return {
        rule_id: 'NonGetRenderingPage.html_on_post',
        hint_md:
          `Page renders HTML but is set to \`method: ${method}\`. Browsers always issue GET — ` +
          `every navigation to this URL will 404. Two valid shapes:\n\n` +
          `**Landing / display page** — drop the \`method:\` field (or set \`method: get\`); have any ` +
          `embedded form POST to a separate API endpoint:\n` +
          '```liquid\n' +
          `---\nslug: contact\n---\n` +
          `<form action="/api/contacts/create" method="post">\n  <!-- fields -->\n</form>\n` +
          '```\n' +
          `**Form-handling endpoint** — rename the slug under \`/api/\` and switch to JSON output:\n` +
          '```liquid\n' +
          `---\nslug: api/contacts/create\nmethod: ${method}\nformat: json\n---\n` +
          `{% graphql result = 'contacts/create', ...context.params.contact %}\n` +
          `{{ result | json }}\n` +
          '```',
        fixes: [
          {
            type: 'guidance',
            description:
              `Decide intent: (a) **landing page** — remove \`method: ${method}\` from front matter; the ` +
              `form on this page should action to an \`/api/...\` slug. (b) **API handler** — move the slug ` +
              `under \`/api/\`, add \`format: json\`, replace the HTML body with a \`{% graphql %}\` call.`,
          },
        ],
        confidence: 0.9,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'pages' },
          reason:
            'Page method semantics — GET serves browsers, non-GET handles form / fetch payloads.',
        },
      };
    },
  },

  {
    id: 'NonGetRenderingPage.get_form_target',
    check: 'pos-supervisor:NonGetRenderingPage',
    priority: 15,
    when: (diag: RuleDiagnostic, _facts: RuleFacts) => GET_FORM_TARGET_RE.test(diag.message ?? ''),
    apply: (diag: RuleDiagnostic, _facts: RuleFacts) => {
      const m = (diag.message ?? '').match(GET_FORM_TARGET_RE);
      const action = m?.[1] ?? '<action>';
      const stripped = action.replace(/^\/+/, '');
      const apiAction = `/api/${stripped}`;
      const apiPagePath = `app/views/pages/api/${stripped}.liquid`;
      return {
        rule_id: 'NonGetRenderingPage.get_form_target',
        hint_md:
          `\`<form>\` on this GET page posts to \`${action}\`. That action target is not under an ` +
          `internal-API prefix (\`/api/\`, \`/_/\`, \`/internal/\`) and isn't the page's own slug, ` +
          `so the submission has nowhere valid to land — unless an explicit \`method: post\` page already ` +
          `serves \`${action}\`. The canonical fix is to route the form through an API page:\n\n` +
          `1. Update the form action: \`<form action="${apiAction}" method="post">\`.\n` +
          `2. Create the API page at \`${apiPagePath}\` with \`method: post\`, \`format: json\`, and a ` +
          `\`{% graphql %}\` body.`,
        fixes: [
          {
            type: 'guidance',
            description:
              `Change the form action from \`${action}\` to \`${apiAction}\` and create ` +
              `\`${apiPagePath}\` as a \`method: post\` / \`format: json\` page. ` +
              `Alternative (only if you control \`${action}\` already): verify that \`${action}\` is served ` +
              `by a page with \`method: post\` — if not, NonGetRenderingPage.html_on_post will fire there.`,
          },
        ],
        confidence: 0.85,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'forms' },
          reason:
            'Form submission patterns — actions must hit a page with the matching `method:` verb.',
        },
      };
    },
  },

  {
    id: 'NonGetRenderingPage.default',
    check: 'pos-supervisor:NonGetRenderingPage',
    priority: 100,
    when: () => true,
    apply: (_diag: RuleDiagnostic, _facts: RuleFacts) => ({
      rule_id: 'NonGetRenderingPage.default',
      hint_md:
        `Page method or form-target configuration is off. Read the upstream message for specifics — ` +
        `the canonical platformOS shapes are:\n` +
        `  • UI page → \`method: get\` (or omit), HTML body, layout allowed.\n` +
        `  • API endpoint → slug under \`/api/\`, \`method: post\`/etc., \`format: json\`, no layout, ` +
        `body is \`{% graphql %}\` + \`{{ result | json }}\`.\n` +
        `  • Forms on GET pages → \`action="/api/<endpoint>"\` so the POST lands on the API page.`,
      fixes: [
        {
          type: 'guidance',
          description:
            `Decide whether this page is a UI page (GET, HTML) or an API page (non-GET, JSON). ` +
            `Convert front matter and body to match — see \`domain_guide(pages)\` for the canonical layouts.`,
        },
      ],
      confidence: 0.6,
    }),
  },
];

// Re-exported for tests + diagnostic-pipeline introspection.
export const _internal = { API_RENDERS_HTML_RE, HTML_ON_POST_RE, GET_FORM_TARGET_RE };
