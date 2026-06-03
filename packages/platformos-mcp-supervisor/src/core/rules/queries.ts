/**
 * Fact-graph query helpers consumed by the rule library.
 *
 * Pure functions: `(graph, …) → result`. No side effects, no caching.
 * Each helper wraps a small `ProjectFactGraph` traversal in a stable name
 * the rule files reference (`partialNames`, `classifyPath`, `nearestByLevenshtein`,
 * …). The wrappers exist so rule code stays readable and the graph's
 * private representation can evolve without rewriting every rule.
 *
 * v1 trim: dropped `commandPaths`, `queryPaths`, `schemaNames`,
 * `graphqlOperations` — verified by grep to have zero in-scope readers
 * (used only by out-of-scope `analyze-project` / `lookup`).
 */

import type { ProjectFactGraph } from '../project-fact-graph';

export interface NearestMatch {
  name: string;
  distance: number;
}

/**
 * Top-`k` candidates ranked by Levenshtein distance to `name`. Returned
 * only when their distance is within `max(name.length * 0.6, 3)` — beyond
 * that, the suggestion is more noise than help.
 */
export function nearestByLevenshtein(
  name: string,
  candidates: ReadonlyArray<string>,
  k: number = 5,
): NearestMatch[] {
  if (!name || !candidates || candidates.length === 0) return [];
  const threshold = Math.max(name.length * 0.6, 3);
  return candidates
    .map((c) => ({ name: c, distance: levenshtein(name, c) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .filter((c) => c.distance <= threshold);
}

export function partialNames(graph: ProjectFactGraph): string[] {
  return graph.nodesByType('partial').map((n) => n.key);
}

/**
 * BFS over the graph's `depends_on` edges from `filePath`, returning every
 * partial reachable transitively. Cycle-safe via a `visited` set.
 */
export function partialsReachableFrom(graph: ProjectFactGraph, filePath: string): string[] {
  const visited = new Set<string>();
  const queue: string[] = [filePath];
  const reachable: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of graph.dependsOn(current)) {
      const node = graph.nodeByPath(dep);
      if (node?.type === 'partial') reachable.push(node.key);
      queue.push(dep);
    }
  }
  return reachable;
}

export function dependentsOf(graph: ProjectFactGraph, filePath: string): string[] {
  return graph.referencedBy(filePath);
}

/**
 * Translation keys for `locale`, with the leading `<locale>.` stripped.
 *
 * The graph stores keys exactly as `flattenYaml` emits them. When the
 * YAML root is the locale (the platformOS-correct shape), keys arrive
 * prefixed (`en.app.title`). When the file is mis-shaped (no locale
 * wrapper), keys come through bare (`app.title`). Liquid's `'foo' | t`
 * never expects the prefix — it auto-prepends the active locale. Strip
 * here so `nearestByLevenshtein` suggestions are usable verbatim.
 */
export function translationKeysForLocale(graph: ProjectFactGraph, locale: string = 'en'): string[] {
  const prefix = `${locale}.`;
  return graph
    .nodesByType('translation')
    .filter((n) => n.locale === locale)
    .map((n) => {
      const key = n.key;
      return key && key.startsWith(prefix) ? key.slice(prefix.length) : key;
    });
}

/**
 * Strip a leading `<locale>.` from a translation key. Returns the key
 * unchanged when no prefix is present. Used by extractor-side rules that
 * compare an agent-supplied key against the canonical bare-key shape.
 */
export function stripLocalePrefix(key: string | null | undefined, locale: string = 'en'): string {
  if (!key) return key ?? '';
  const prefix = `${locale}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function fileExists(graph: ProjectFactGraph, path: string): boolean {
  return graph.hasNode(path);
}

/**
 * Asset paths relative to `app/assets/`, no leading slash. Empty when
 * the project has no assets directory or the scan failed.
 */
export function assetNames(graph: ProjectFactGraph): string[] {
  return graph.nodesByType('asset').map((n) => n.key);
}

// ── Path classification ────────────────────────────────────────────────────

/**
 * Discriminated classification of a partial-call name.
 *   - `'unknown'`             — null/empty.
 *   - `'module'`              — `modules/<name>/…`; no project-local path.
 *   - `'invalid_lib_prefix'`  — `lib/commands/…` or `lib/queries/…`; the
 *                                `lib/` prefix expands to `app/lib/lib/…`
 *                                at runtime and never resolves.
 *                                Carries `correctedName` (the same name
 *                                with `lib/` stripped) so rules can emit
 *                                a path-correction fix.
 *   - `'command'` / `'query'` — bare `commands/…` / `queries/…`.
 *   - `'partial'`             — everything else, treated as a
 *                                `views/partials/<name>.liquid` ref.
 */
export type PathClassification =
  | { type: 'unknown'; path: null }
  | { type: 'module'; path: null }
  | { type: 'invalid_lib_prefix'; path: null; correctedName: string }
  | { type: 'command'; path: string }
  | { type: 'query'; path: string }
  | { type: 'partial'; path: string };

export function classifyPath(partialName: string | null | undefined): PathClassification {
  if (!partialName) return { type: 'unknown', path: null };
  if (partialName.startsWith('modules/')) return { type: 'module', path: null };
  if (partialName.startsWith('lib/commands/') || partialName.startsWith('lib/queries/')) {
    return {
      type: 'invalid_lib_prefix',
      path: null,
      correctedName: partialName.slice('lib/'.length),
    };
  }
  if (partialName.startsWith('commands/')) {
    return { type: 'command', path: `app/lib/${partialName}.liquid` };
  }
  if (partialName.startsWith('queries/')) {
    return { type: 'query', path: `app/lib/${partialName}.liquid` };
  }
  return { type: 'partial', path: `app/views/partials/${partialName}.liquid` };
}

export function callerCount(graph: ProjectFactGraph | null | undefined, filePath: string): number {
  if (!graph || !filePath) return 0;
  return graph.referencedBy(filePath).length;
}

export function isOrphan(graph: ProjectFactGraph | null | undefined, filePath: string): boolean {
  if (!graph || !filePath) return false;
  return graph.hasNode(filePath) && graph.referencedBy(filePath).length === 0;
}

export function hasDocParams(
  graph: ProjectFactGraph | null | undefined,
  filePath: string,
): boolean {
  if (!graph || !filePath) return false;
  const node = graph.nodeByPath(filePath);
  return Array.isArray(node?.params) && (node?.params?.length ?? 0) > 0;
}

export type FileType =
  | 'page'
  | 'partial'
  | 'layout'
  | 'command'
  | 'query'
  | 'graphql'
  | 'schema'
  | 'module'
  | 'unknown';

export function classifyFileType(filePath: string | null | undefined): FileType {
  if (!filePath) return 'unknown';
  if (filePath.startsWith('app/views/pages/')) return 'page';
  if (filePath.startsWith('app/views/partials/')) return 'partial';
  if (filePath.startsWith('app/views/layouts/')) return 'layout';
  if (filePath.startsWith('app/lib/commands/')) return 'command';
  if (filePath.startsWith('app/lib/queries/')) return 'query';
  if (filePath.startsWith('app/graphql/')) return 'graphql';
  if (filePath.startsWith('app/schema/')) return 'schema';
  if (filePath.startsWith('modules/')) return 'module';
  return 'unknown';
}

// ── Local Levenshtein (identical to source; kept private) ──────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = b.length;
  const n = a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= m; i++) matrix[i] = [i];
  for (let j = 0; j <= n; j++) matrix[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[m][n];
}
