import { path, UriString } from '@platformos/platformos-check-common';
import { extractGraphqlTables, extractSchemaTable } from '@platformos/platformos-common';

import {
  AppGraph,
  AppModule,
  AugmentedDependencies,
  GraphBuildOptions,
  IDependencies,
  ModuleType,
} from '../types';
import { assertNever, exists, unique } from '../utils';
import { augmentDependencies } from './augment';
import { getModule } from './module';
import { isEntryPoint } from './query';
import { bind, extractStructural, resolveLiquidReferences } from './traverse';

/** The kind of on-disk change to apply to a single file. */
export type FileChangeKind = 'added' | 'modified' | 'deleted';

/**
 * Apply a single file's on-disk change to an ALREADY-BUILT {@link AppGraph}
 * in place, WITHOUT rebuilding the whole project.
 *
 * A file's OUTGOING edges depend only on its own content (parse it → its
 * render/include/function/background/graphql/asset/layout edges; no cross-file
 * inference), so a change is applied in O(edges of the changed file) rather than
 * O(project). The reverse index (`references`) is patched so every other file's
 * dependents stay correct; incoming edges to the changed file resolve
 * automatically because an edge is keyed by its canonical target URI and
 * existence is a node property — flipping `exists` re-resolves them with no
 * rewiring.
 *
 * Resolution reuses the exact same seams as {@link buildAppGraph}
 * ({@link resolveLiquidReferences} + the URI-normalizing module factories +
 * {@link bind}), so an incremental result can never drift from a from-scratch
 * build. Dependencies are augmented FRESH per call (like the build), so the
 * changed file — and any newly-reachable leaf — is re-read from disk, never
 * served from a stale parse.
 *
 * PRECONDITION: `graph` was built with every edge-source liquid file
 * (page/layout/partial+lib) as an entry point — the never-stale supervisor cache
 * mode. Under it, every liquid target is already a materialized entry-point node,
 * so only reached-only leaves (graphql/asset) are materialized on demand or
 * garbage-collected; no traversal recursion is needed. Applying a change for a
 * file the graph does not model (a schema `.yml`, an unreferenced leaf) is a
 * no-op — schema discovery is a full-build concern.
 *
 * INVARIANT: applying any sequence of changes yields a graph equal to a
 * from-scratch `buildAppGraph` of the same final disk state.
 */
export async function applyFileChange(
  graph: AppGraph,
  uri: UriString,
  kind: FileChangeKind,
  ideps: IDependencies,
  options: GraphBuildOptions = {},
): Promise<void> {
  // Match the module-factory keys (forward slashes), and augment FRESH so the
  // default getSourceCode re-reads the changed file rather than a memoized parse.
  const key = path.normalize(uri);
  const deps = augmentDependencies(graph.rootUri, ideps);

  switch (kind) {
    case 'deleted':
      removeFile(graph, key);
      return;
    case 'added':
      await addFile(graph, key, deps, options);
      return;
    case 'modified':
      // A modify is a remove of the old edges followed by an add of the new ones:
      // provably equivalent to a re-resolve, and it reuses one code path.
      removeFile(graph, key);
      await addFile(graph, key, deps, options);
      return;
    default:
      return assertNever(kind);
  }
}

/**
 * Detach a file from the graph: drop its OUTGOING edges from every target's
 * reverse index (garbage-collecting any target that thereby becomes an
 * unreachable reached-only leaf — one a from-scratch build would not
 * materialize), drop it from the entry-point roots, then remove the node itself
 * unless something still references it (in which case it survives as a
 * known-missing target).
 */
function removeFile(graph: AppGraph, uri: UriString): void {
  const node = graph.modules[uri];
  if (!node) return;

  const targetUris = unique(node.dependencies.map((dep) => dep.target.uri));
  node.dependencies = [];

  for (const targetUri of targetUris) {
    if (targetUri === uri) continue; // self-edge: handled with the node itself, below
    const target = graph.modules[targetUri];
    if (!target) continue;
    target.references = target.references.filter((ref) => ref.source.uri !== uri);
    // A non-entry-point node with no remaining incoming edges is unreachable, so a
    // from-scratch build would not contain it (only edge-source liquid files are
    // entry points; leaves and missing partials are materialized only when
    // reached). Leaves have no outgoing edges, so removing one never cascades.
    if (target.references.length === 0 && !isEntryPoint(graph, targetUri)) {
      delete graph.modules[targetUri];
    }
  }

  // An absent file is not an entry point in a from-scratch build.
  graph.entryPoints = graph.entryPoints.filter((entry) => entry.uri !== uri);

  // Also drop this file's self-edges from its own reverse index.
  node.references = node.references.filter((ref) => ref.source.uri !== uri);

  if (node.references.length === 0) {
    delete graph.modules[uri];
  } else {
    // Still referenced → survives as a known-missing target (exists:false),
    // exactly as a from-scratch build would materialize it.
    node.exists = false;
  }
}

/**
 * Attach a file to the graph: materialize/refresh its node, mark it as an entry
 * point if it is an edge-source liquid file, and resolve + bind its outgoing
 * edges (materializing any newly-reached leaf target). A previously-missing file
 * that is now on disk resolves its incoming edges automatically once `exists`
 * flips true — those edges already point at this URI.
 */
async function addFile(
  graph: AppGraph,
  uri: UriString,
  deps: AugmentedDependencies,
  options: GraphBuildOptions,
): Promise<void> {
  const existing = graph.modules[uri];
  const node = existing ?? getModule(graph, uri);
  if (!node) return; // not a graph-classifiable file (e.g. a schema .yml or unsupported type)

  // A NEW non-liquid file (asset/graphql) is reached-only: a from-scratch build
  // materializes it only when something references it. If nothing does yet, leave
  // it out — a later modify of a referrer materializes it via materializeTarget.
  if (!existing && node.type !== ModuleType.Liquid) return;

  node.exists = await exists(deps.fs, uri);
  graph.modules[uri] = node;

  if (!node.exists) return; // recorded as a known-missing node; no roots, edges, or table

  if (node.type !== ModuleType.Liquid) {
    // An existing leaf that (re)appeared: refresh its neutral table fact.
    await readLeafTable(node, deps);
    return;
  }

  // Every liquid module the factories produce (page/layout/partial) is an edge
  // source and therefore an entry point in the cache's build mode.
  if (!isEntryPoint(graph, uri)) graph.entryPoints.push(node);

  const sourceCode = await deps.getSourceCode(uri);
  if (options.includeStructural) {
    node.structural = await extractStructural(sourceCode, uri);
  }

  const references = await resolveLiquidReferences(graph, sourceCode, deps);
  for (const reference of references) {
    await materializeTarget(graph, reference.target, deps);
    bind(node, reference.target, {
      sourceRange: reference.sourceRange,
      kind: reference.kind,
      args: reference.args,
    });
  }
}

/**
 * Ensure an edge target is present in the graph with its existence (and, for a
 * leaf that exists, its neutral table fact) recorded — the incremental
 * equivalent of {@link traverseModule} reaching a target. A target already in
 * the graph is left untouched (its own edges/refs are already correct); under
 * the all-liquid precondition a liquid target is always already present, so only
 * leaves and missing partials are ever materialized here.
 */
async function materializeTarget(
  graph: AppGraph,
  target: AppModule,
  deps: AugmentedDependencies,
): Promise<void> {
  if (graph.modules[target.uri]) return;
  graph.modules[target.uri] = target;
  target.exists = await exists(deps.fs, target.uri);
  if (target.exists) await readLeafTable(target, deps);
}

/**
 * Record a leaf module's neutral platform table fact — the GraphQL operation's
 * `table` filters, or a schema's model `name:` — reusing platformos-common's
 * parsers, exactly as {@link traverseModule} does. A no-op for asset/liquid
 * modules.
 */
async function readLeafTable(module: AppModule, deps: AugmentedDependencies): Promise<void> {
  if (module.type === ModuleType.GraphQL) {
    const sourceCode = await deps.getSourceCode(module.uri);
    module.tables = extractGraphqlTables(sourceCode.source);
  } else if (module.type === ModuleType.Schema) {
    const sourceCode = await deps.getSourceCode(module.uri);
    module.table = extractSchemaTable(sourceCode.source);
  }
}
