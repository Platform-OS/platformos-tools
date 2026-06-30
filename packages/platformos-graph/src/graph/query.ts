import { levenshtein, path, UriString } from '@platformos/platformos-check-common';
import { AppGraph, AppModule, Reference } from '../types';

/**
 * Project-structure queries over a BUILT {@link AppGraph}.
 *
 * Every function here is PURE and synchronous: it only reads the in-memory
 * graph produced by `buildAppGraph`. All I/O (disk traversal, parsing,
 * resolution) stays in `buildAppGraph`; this layer never touches the filesystem.
 *
 * These resurrect the old in-supervisor `ProjectFactGraph` / `ProjectMap`
 * capabilities as the graph package's own API, so consumers (the MCP supervisor,
 * the LSP) read project facts without re-deriving any graph logic.
 *
 * Note on graph scope: `buildAppGraph` only materializes modules reachable from
 * its entry points. Whole-project queries like {@link orphans} are therefore
 * only as complete as the graph they are given — to detect unreferenced files,
 * build the graph with every file as an entry point.
 */

/** The outgoing dependency edges of `uri` (what it renders/includes/runs/queries/wraps). */
export function dependenciesOf(graph: AppGraph, uri: UriString): Reference[] {
  return graph.modules[uri]?.dependencies ?? [];
}

/** The incoming reference edges to `uri` (who renders/includes/runs/queries/wraps it). */
export function dependentsOf(graph: AppGraph, uri: UriString): Reference[] {
  return graph.modules[uri]?.references ?? [];
}

/**
 * Whether `uri` is a module in the graph that resolves to a file on disk.
 * Returns `false` for a URI absent from the graph or a known-missing target.
 */
export function exists(graph: AppGraph, uri: UriString): boolean {
  return graph.modules[uri]?.exists ?? false;
}

/** Whether `uri` is one of the graph's entry points (a page or layout root). */
export function isEntryPoint(graph: AppGraph, uri: UriString): boolean {
  return graph.entryPoints.some((entry) => entry.uri === uri);
}

/**
 * Whether `uri` is an orphan: an existing, non-entry-point module that nothing
 * references. Entry points (pages, layouts) are roots reachable independently of
 * render edges, so they are never orphans; known-missing targets are "missing"
 * (see {@link missingDependencies}), not orphans.
 */
export function isOrphan(graph: AppGraph, uri: UriString): boolean {
  const module = graph.modules[uri];
  if (!module || module.exists === false) return false;
  if (isEntryPoint(graph, uri)) return false;
  return module.references.length === 0;
}

/** Every orphan module in the graph (see {@link isOrphan}), sorted by URI. */
export function orphans(graph: AppGraph): AppModule[] {
  return Object.values(graph.modules)
    .filter((module) => isOrphan(graph, module.uri))
    .sort((a, b) => a.uri.localeCompare(b.uri));
}

/**
 * Every module URI transitively reachable from `uri` by following outgoing
 * dependency edges, sorted. Excludes `uri` itself unless a cycle leads back to
 * it. Modules absent from the graph contribute nothing.
 */
export function reachableFrom(graph: AppGraph, uri: UriString): UriString[] {
  const seen = new Set<UriString>();
  const queue: UriString[] = dependenciesOf(graph, uri).map((dep) => dep.target.uri);

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dep of dependenciesOf(graph, next)) queue.push(dep.target.uri);
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** The outgoing edges of `uri` whose target does not exist on disk. */
export function missingDependencies(graph: AppGraph, uri: UriString): Reference[] {
  return dependenciesOf(graph, uri).filter((ref) => !exists(graph, ref.target.uri));
}

/**
 * Every edge in the graph that points at a non-existent target — the project's
 * unresolved references. Sorted by (source URI, target URI) for stable output.
 */
export function missingTargets(graph: AppGraph): Reference[] {
  return Object.values(graph.modules)
    .flatMap((module) => module.dependencies)
    .filter((ref) => !exists(graph, ref.target.uri))
    .sort(
      (a, b) =>
        a.source.uri.localeCompare(b.source.uri) || a.target.uri.localeCompare(b.target.uri),
    );
}

export interface NearestModulesOptions {
  /** Maximum number of candidates to return, closest first. Default 3. */
  limit?: number;
  /** Maximum edit distance to include. Default: no cap (consumer decides relevance). */
  maxDistance?: number;
}

/**
 * The existing modules whose names are closest to `uri` — the "did you mean?"
 * candidate set for a typo'd or missing reference.
 *
 * Candidates are restricted to the SAME category as `uri` (same module `type`,
 * and for Liquid the same `kind`), so a missing `{% render %}` only suggests
 * partials, a missing `{% graphql %}` only graphql operations, etc. Ranked by
 * Levenshtein distance over the project-relative path (reusing check-common's
 * `levenshtein` + `path.relative` — never re-implemented), closest first, ties
 * broken by URI. `uri` itself and known-missing modules are excluded.
 *
 * Pure over the graph: candidates come only from modules present in it, so build
 * with every file as an entry point for a complete candidate pool (see header).
 */
export function nearestModules(
  graph: AppGraph,
  uri: UriString,
  options: NearestModulesOptions = {},
): AppModule[] {
  const { limit = 3, maxDistance = Infinity } = options;
  const target = graph.modules[uri];
  if (!target) return [];

  const targetPath = path.relative(uri, graph.rootUri);

  return Object.values(graph.modules)
    .filter(
      (module) =>
        module.uri !== uri &&
        module.exists !== false &&
        module.type === target.type &&
        module.kind === target.kind,
    )
    .map((module) => ({
      module,
      distance: levenshtein(path.relative(module.uri, graph.rootUri), targetPath),
    }))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.module.uri.localeCompare(b.module.uri))
    .slice(0, limit)
    .map((candidate) => candidate.module);
}
