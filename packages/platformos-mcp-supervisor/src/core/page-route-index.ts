/**
 * Page-route index — a snapshot of every route the project actually serves.
 *
 * Purpose: the LSP's `MissingPage` check fires for any route reference
 * whose page is not in the file currently under analysis. `validate_code`
 * analyses one file at a time, so a header partial that links to `/notes`,
 * `/dashboard`, `/` triggers `MissingPage` for each link even though those
 * pages exist as separate files (`app/views/pages/notes/index.html.liquid`,
 * `app/views/pages/dashboard.liquid`, `app/views/pages/index.liquid`).
 *
 * The agent is told "no page found" for routes the project clearly serves —
 * a textbook ghost error. Same mitigation as `MissingAsset` and
 * `TranslationKeyExists`: scan the filesystem, build the truth, suppress
 * the false positives.
 *
 * Route resolution rules (matching platformOS):
 *   - frontmatter `slug:` wins if present.
 *   - else the path under `app/views/pages/` minus the `.liquid` /
 *     `.html.liquid` extension is the route.
 *   - `index.liquid` (any depth) collapses its `/index` suffix; the
 *     directory itself becomes the route. So
 *     `app/views/pages/index.liquid` → `''` (root) and
 *     `app/views/pages/notes/index.html.liquid` → `notes`.
 *   - frontmatter `method:` wins for HTTP method, defaulting to `get`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import normalize from 'normalize-path';

const PAGES_SUBDIR = 'app/views/pages';

export interface PageRouteIndex {
  /**
   * `route` → set of HTTP methods that serve it (lowercase).
   * Routes are normalised: no leading slash, no trailing `/index`,
   * root is the empty string.
   */
  routes: Map<string, Set<string>>;
}

export interface PageOverlay {
  filePath: string;
  content: string;
}

export interface ParsedMissingPage {
  route: string;
  method: string;
}

export type PageRouteResolution =
  | { status: 'exists' }
  | { status: 'wrong-method'; methods: string[] }
  | { status: 'missing' };

/**
 * Build a route → methods index from the project's pages directory.
 *
 * The optional `overlay` represents the file CURRENTLY under validation.
 * Its in-memory content is used in place of (or in addition to) the
 * on-disk version. This is load-bearing for the self-page case: when the
 * agent runs `validate_code` on `app/views/pages/index.liquid` with
 * `method: post` in-memory frontmatter while disk still has no method
 * declaration, the LSP fires `MissingPage` for route `/` (POST). The
 * on-disk scan alone would not see the in-memory frontmatter and the false
 * positive would survive verification — even though, the moment the agent
 * writes, the route IS served.
 *
 * Overlay rules:
 *   - `filePath` may be relative (resolved against `projectDir`) or absolute.
 *   - Only files under `app/views/pages/` are considered. A non-page
 *     overlay (e.g., a partial under validation) is ignored — the index
 *     covers pages only.
 *   - When the same path also exists on disk, the disk read is skipped
 *     and the overlay frontmatter wins. When the path does not exist on
 *     disk yet, the overlay adds a new entry to the index.
 */
export function buildPageRouteIndex(
  projectDir: string,
  overlay: PageOverlay | null = null,
): PageRouteIndex {
  const routes = new Map<string, Set<string>>();
  if (!projectDir) return { routes };

  const rootAbs = join(projectDir, PAGES_SUBDIR);
  if (!existsSync(rootAbs)) return { routes };

  const files: string[] = [];
  const stack: string[] = [rootAbs];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.liquid')) continue;
      files.push(abs);
    }
  }

  // Resolve the overlay (if any) to an absolute path under the pages root.
  // Overlays outside `app/views/pages/` are ignored — the route index
  // covers pages only, and partials/layouts/assets cannot serve a route.
  let overlayAbs: string | null = null;
  if (
    overlay &&
    typeof overlay.filePath === 'string' &&
    typeof overlay.content === 'string' &&
    /\.liquid$/.test(overlay.filePath)
  ) {
    const abs = isAbsolute(overlay.filePath)
      ? overlay.filePath
      : join(projectDir, overlay.filePath);
    if (abs === rootAbs || abs.startsWith(rootAbs + sep)) {
      overlayAbs = abs;
      if (!files.includes(abs)) files.push(abs);
    }
  }

  for (const abs of files) {
    let raw: string;
    if (abs === overlayAbs) {
      raw = overlay!.content;
    } else {
      try {
        raw = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
    }

    const rel = normalize(relative(rootAbs, abs));
    const { slug, method } = extractFrontmatter(raw);

    const route = normalizeRoute(slug ?? routeFromPath(rel));
    const m = (method ?? 'get').toLowerCase();
    const existing = routes.get(route);
    if (existing) existing.add(m);
    else routes.set(route, new Set([m]));
  }

  return { routes };
}

/**
 * Read a tiny slice of frontmatter — only what the route check needs. We
 * do NOT pull in the full liquid-html-parser here: this index runs on
 * every `validate_code` call, so the cheap regex over the head of the
 * file is the right tradeoff. Frontmatter, when present, is `---` … `---`
 * at the start of the file; ignoring everything after the closing `---`
 * keeps a page that has the word "slug:" in its body from contaminating
 * the route.
 */
function extractFrontmatter(content: string): { slug: string | null; method: string | null } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { slug: null, method: null };
  const head = m[1];
  const slug = head.match(/^slug:\s*(.+?)\s*$/m)?.[1] ?? null;
  const method = head.match(/^method:\s*(.+?)\s*$/m)?.[1] ?? null;
  return { slug, method };
}

function routeFromPath(relUnderPages: string): string {
  return relUnderPages.replace(/\.html\.liquid$/, '').replace(/\.liquid$/, '');
}

/**
 * Normalise a route into the canonical key the index uses.
 *
 *   - strip leading slashes
 *   - collapse a trailing `/index` (the directory itself is the route)
 *   - root page becomes the empty string
 */
export function normalizeRoute(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  let p = raw.trim();
  while (p.startsWith('/')) p = p.slice(1);
  if (p === 'index') return '';
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return p;
}

/**
 * Parse a `MissingPage` diagnostic message into `{ route, method }`.
 *
 * Known shapes:
 *   - `No page found for route '/notes' (GET)`
 *   - `Page 'blog_posts/show' not found`
 *   - `Missing page at slug 'blog_posts'`
 *
 * Method defaults to `'get'` when not present.
 */
export function parseMissingPageMessage(
  message: string | null | undefined,
): ParsedMissingPage | null {
  if (!message) return null;
  const quoted = message.match(/['"`]([^'"`]+)['"`]/);
  if (!quoted) return null;
  const route = normalizeRoute(quoted[1]);
  const methodMatch = message.match(/\(([A-Za-z]+)\)/);
  const method = (methodMatch?.[1] ?? 'get').toLowerCase();
  return { route, method };
}

/**
 * Look up a reported route against the index.
 *
 *   - `exists`       — a page serves that route + method; suppress.
 *   - `wrong-method` — route exists, but for other methods.
 *   - `missing`      — no page serves that route at all; diagnostic stands.
 */
export function resolvePageRoute(
  reportedRoute: string,
  reportedMethod: string,
  index: PageRouteIndex,
): PageRouteResolution {
  const route = normalizeRoute(reportedRoute);
  const methods = index.routes.get(route);
  if (!methods) return { status: 'missing' };
  if (methods.has(reportedMethod)) return { status: 'exists' };
  return { status: 'wrong-method', methods: [...methods] };
}
