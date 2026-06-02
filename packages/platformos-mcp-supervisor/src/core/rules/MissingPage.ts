/**
 * MissingPage rule — `link_to '/foo'`, `redirect_to '/foo'`, etc. references
 * a route the project doesn't serve. The diagnostic-pipeline already
 * suppresses references whose page is on disk (via `buildPageRouteIndex` +
 * `resolvePageRoute`); by the time the diagnostic reaches this rule the
 * route is genuinely missing OR served with a different method.
 *
 * Pre-rule the check landed as `.unmatched`. The bare LSP message
 * (`No page found for route '/foo' (GET)`) gives the agent no signal on
 * whether to fix the route, change method, or create the page.
 *
 * Subrules:
 *   10  — typo: extracted route is Levenshtein-close to an indexed page slug
 *         → suggest renaming the reference.
 *   100 — default: emit a structured decision tree (typo / new page / method
 *         mismatch) and propose a `create_file` for the most-likely page path.
 *
 * Note: route ↔ method mismatch detection lives in the pipeline upstream.
 * This rule treats every surviving diagnostic as a "page truly missing"
 * outcome and points the agent at the three valid resolutions.
 */
import type { Rule } from './engine';
import type { ProjectFactGraph } from '../project-fact-graph';
import { nearestByLevenshtein } from './queries';

interface ParsedRoute {
  route: string;
  method: string;
}

export const rules: Rule[] = [
  {
    id: 'MissingPage.typo',
    check: 'MissingPage',
    priority: 10,
    when: (diag, facts) => {
      const parsed = parseMissingPageMessage(diag.message);
      if (!parsed) return false;
      const candidates = pageRouteCandidates(facts.graph);
      if (candidates.length === 0) return false;
      return nearestByLevenshtein(parsed.route, candidates, 3).length > 0;
    },
    apply: (diag, facts) => {
      const parsed = parseMissingPageMessage(diag.message);
      if (!parsed) return null;
      const candidates = pageRouteCandidates(facts.graph);
      const nearest = nearestByLevenshtein(parsed.route, candidates, 3);
      const best = nearest[0];
      if (!best || best.distance > 3) return null;
      const list = nearest.map((n) => `\`/${n.name}\``).join(', ');
      return {
        rule_id: 'MissingPage.typo',
        hint_md:
          `No page serves \`/${parsed.route}\` (${parsed.method.toUpperCase()}), but the project has nearby routes: ${list}. ` +
          `If the reference is a typo, fix it; if the page is genuinely missing, scaffold it now.`,
        fixes: [{
          type: 'guidance',
          description:
            `Replace \`'/${parsed.route}'\` with \`'/${best.name}'\` in the link/redirect (or correct the slug ` +
            `to match \`/${parsed.route}\` if you actually meant the latter). Distance ${best.distance} — ` +
            `verify the correction before applying.`,
        }],
        confidence: best.distance <= 1 ? 0.85 : 0.7,
      };
    },
  },

  {
    id: 'MissingPage.default',
    check: 'MissingPage',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const parsed = parseMissingPageMessage(diag.message);
      const route = parsed ? parsed.route : null;       // can legitimately be '' for root
      const method = parsed?.method ?? 'get';
      const haveRoute = route !== null;
      const inferredPath = haveRoute ? routeToPagePath(route) : 'app/views/pages/<route>.liquid';
      const routeSpan = haveRoute ? `\`/${route}\`` : 'this route';
      // The root page conventionally has either an empty `slug:` or none at
      // all (the file-path → route fallback covers it). Distinguish the
      // wording so an empty `slug:` line doesn't read like a typo.
      const slugBlurb = !haveRoute
        ? '(set `slug:` to the desired URL)'
        : route === ''
          ? '(omit `slug:` — the root page lives at `app/views/pages/index.liquid` and serves `/` automatically)'
          : `(\`slug: ${route}\`)`;

      const hint =
        `${routeSpan} (${method.toUpperCase()}) is not served by any page in this project. ` +
        `Three valid resolutions:\n` +
        `  • **Typo in the reference** — fix the slug at the call site (\`link_to\`, \`redirect_to\`, ` +
        `\`form action\`, etc.).\n` +
        `  • **New page** — scaffold a page at \`${inferredPath}\` ${slugBlurb}. ` +
        `The file path alone determines the route when no \`slug:\` front-matter key is present.\n` +
        `  • **Method mismatch** — a page may serve this URL for a different HTTP method (e.g. agent ` +
        `wrote ${method.toUpperCase()} but the page is GET-only). Open the candidate page and check ` +
        `its \`method:\` front-matter key.\n\n` +
        `If you're mid-feature and the page is in the plan but not yet on disk, pass ` +
        `\`pending_pages=["${inferredPath}"]\` to validate_code so this stops firing while you write it.`;

      return {
        rule_id: 'MissingPage.default',
        hint_md: hint,
        fixes: [{
          type: 'create_file',
          path: inferredPath,
          description:
            `Create the missing page at \`${inferredPath}\` (slug: \`${route ?? '<route>'}\`). ` +
            `Only apply if you intend to add this page — if the route was a typo at the call site, ` +
            `fix the reference instead.`,
        }],
        confidence: 0.6,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'pages' },
          reason: 'Pages domain guide explains slug/method semantics and the file-path → route mapping.',
        },
      };
    },
  },
];

/**
 * Mirror of `parseMissingPageMessage` from page-route-index.ts — kept local
 * to avoid creating a load-order dependency between the rule engine and the
 * pipeline. Shape matches; behaviour identical for the messages we receive
 * at this stage. Returns null when the message can't be parsed.
 */
function parseMissingPageMessage(message: string | undefined): ParsedRoute | null {
  if (!message) return null;
  const quoted = message.match(/['"`]([^'"`]+)['"`]/);
  if (!quoted) return null;
  let route = quoted[1].trim();
  while (route.startsWith('/')) route = route.slice(1);
  if (route === 'index') route = '';
  if (route.endsWith('/index')) route = route.slice(0, -'/index'.length);
  const methodMatch = message.match(/\(([A-Za-z]+)\)/);
  const method = (methodMatch?.[1] ?? 'get').toLowerCase();
  return { route, method };
}

/**
 * Enumerate every page slug the project graph knows. Prefers the explicit
 * front-matter slug when present; falls back to deriving from the file path
 * exactly the way the route index does.
 */
function pageRouteCandidates(graph: ProjectFactGraph | undefined): string[] {
  if (!graph) return [];
  const out: string[] = [];
  for (const node of graph.nodesByType('page')) {
    if (typeof node.slug === 'string' && node.slug.length > 0) {
      out.push(normalize(node.slug));
    } else if (node.path) {
      out.push(routeFromPath(node.path));
    }
  }
  return [...new Set(out)];
}

function normalize(raw: string): string {
  let p = raw.trim();
  while (p.startsWith('/')) p = p.slice(1);
  if (p === 'index') return '';
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return p;
}

function routeFromPath(absLikePath: string): string {
  const stripped = absLikePath
    .replace(/^app\/views\/pages\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  return normalize(stripped);
}

function routeToPagePath(route: string): string {
  if (!route || route === '') return 'app/views/pages/index.liquid';
  return `app/views/pages/${route}.liquid`;
}
