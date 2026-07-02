/**
 * On-disk persistence format for the project graph cache (TASK-9.15 Phase 2).
 *
 * The graph is expensive to build from scratch (~a whole-project parse), so it is
 * persisted after each build and RELOADED on server start — a warm cold-start.
 * We persist the derived MODEL (the serialized graph + its per-file fingerprint +
 * entry-point URIs), never the ASTs: the graph is the compact summary, and its
 * O(1) query API is the retrieval.
 *
 * Correctness is still gated by the fingerprint AFTER load: a loaded graph is
 * reconciled against the current disk (fingerprint diff → incremental apply), so
 * a stale-but-valid cache converges to fresh, and a corrupt / wrong-version /
 * wrong-root cache decodes to `null` and the caller falls back to a full rebuild.
 * The format is versioned so an incompatible on-disk cache is never trusted.
 */
import type { UriString } from '@platformos/platformos-check-common';
import {
  deserializeAppGraph,
  serializeAppGraph,
  type AppGraph,
  type SerializableGraph,
} from '@platformos/platformos-graph';

/**
 * Bump on ANY incompatible change to what is persisted or how a loaded graph is
 * interpreted (serialized-graph shape, fingerprint domain, entry-point meaning).
 * A file with a different version is discarded on load — never migrated.
 */
export const CACHE_FORMAT_VERSION = 1;

/** Per-file identity used to detect on-disk change: `mtimeMs:size`. */
export type Fingerprint = Map<UriString, string>;

/** The persisted cache document. `fingerprint` is a Map serialized as entries. */
interface CacheFile {
  version: number;
  rootUri: UriString;
  entryPoints: UriString[];
  graph: SerializableGraph;
  fingerprint: Array<[UriString, string]>;
}

/** Encode a built graph + its fingerprint into the cache-file JSON string. */
export function encodeCacheFile(
  rootUri: UriString,
  graph: AppGraph,
  fingerprint: Fingerprint,
): string {
  const file: CacheFile = {
    version: CACHE_FORMAT_VERSION,
    rootUri,
    entryPoints: graph.entryPoints.map((module) => module.uri),
    graph: serializeAppGraph(graph),
    fingerprint: [...fingerprint],
  };
  return JSON.stringify(file);
}

/**
 * Decode a cache-file string back into a graph + fingerprint, or `null` when it
 * is unusable (unparseable, wrong version, wrong root, or structurally invalid).
 * Never throws — an unusable cache degrades to a rebuild, never a wrong answer.
 */
export function decodeCacheFile(
  text: string,
  expectedRootUri: UriString,
): { graph: AppGraph; fingerprint: Fingerprint } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isCacheFile(parsed)) return null;
  if (parsed.version !== CACHE_FORMAT_VERSION) return null;
  if (parsed.rootUri !== expectedRootUri) return null;

  try {
    return {
      graph: deserializeAppGraph(parsed.graph, parsed.entryPoints),
      fingerprint: new Map(parsed.fingerprint),
    };
  } catch {
    // Structurally malformed beyond the shallow shape check → treat as corrupt.
    return null;
  }
}

/** Shallow structural validation of a parsed cache document. */
function isCacheFile(value: unknown): value is CacheFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  const graph = file.graph as Record<string, unknown> | undefined;
  return (
    typeof file.version === 'number' &&
    typeof file.rootUri === 'string' &&
    Array.isArray(file.entryPoints) &&
    Array.isArray(file.fingerprint) &&
    typeof graph === 'object' &&
    graph !== null &&
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.edges) &&
    typeof graph.rootUri === 'string'
  );
}
