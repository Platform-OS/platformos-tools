/**
 * Project-graph cache at the supervisor I/O edge.
 *
 * The full `AppGraph` is expensive to build (a whole-project parse), so it is
 * built ONCE and thereafter kept fresh INCREMENTALLY — but NEVER served stale.
 * Staleness would mislead the agent (e.g. "nothing depends on this, safe to
 * change" when a caller was added since the build), so the cache is
 * fingerprint-validated on every request: the fingerprint is the AUTHORITY.
 *
 * When the fingerprint moves and a graph already exists, the cache DIFFS the
 * fingerprint against the built graph's and applies ONLY the changed files via
 * platformos-graph's `applyFileChange` (O(changed files), ~ms), then serves the
 * updated graph immediately — no full rebuild, no `computing` gap after a single
 * write (TASK-9.15 Phase 1). `applyFileChange` is provably equivalent to a
 * from-scratch build (TASK-9.14); should incremental apply ever fail, the cache
 * discards the graph and falls back to a full rebuild, so a half-applied graph is
 * never served. Reconciliations are serialized so concurrent lookups can never
 * interleave mutations of the shared graph.
 *
 * The COLD build (no prior graph) is still fired in the background and NEVER
 * awaited on the request path — blast-radius is a secondary signal and must not
 * add latency to, or ever sink, the primary lint gate (mirrors the
 * `runValidateCode` degrade contract). (Persisted cold-start load is Phase 2.)
 *
 * Fingerprint domain = the liquid files that are edge SOURCES (page/layout/
 * partial+lib). Only their add/remove/modify can change any file's dependents;
 * `.graphql`/`.yml`/asset files are leaves. This is also exactly the set fed to
 * `buildAppGraph` as entry points, so dependents are COMPLETE (every caller is
 * traversed) — see the query.ts note on entry-point scope.
 */
import { stat } from 'node:fs/promises';

import {
  isLayout,
  isPage,
  isPartial,
  path,
  recursiveReadDirectory,
  type UriString,
} from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import type { AbstractFileSystem } from '@platformos/platformos-common';
import {
  applyFileChange,
  buildAppGraph,
  type AppGraph,
  type FileChangeKind,
} from '@platformos/platformos-graph';

/** Per-file identity used to detect on-disk change: `mtimeMs:size`. */
type Fingerprint = Map<UriString, string>;

/** The result of asking the cache for a usable graph. */
export type GraphLookup =
  | { graph: AppGraph }
  | { graph: null; reason: 'recomputing' | 'unavailable' };

export interface GraphCacheOptions {
  /** Normalized project root as a `file://` URI. */
  rootUri: UriString;
  /** Filesystem for enumeration/build. Defaults to the real Node fs. */
  fs?: AbstractFileSystem;
  /** Seam for tests: compute the source fingerprint. Defaults to the real disk scan. */
  computeFingerprint?: (rootUri: UriString, fs: AbstractFileSystem) => Promise<Fingerprint>;
  /** Seam for tests: build the graph. Defaults to `buildAppGraph` over the liquid entry points. */
  buildGraph?: (
    rootUri: UriString,
    fs: AbstractFileSystem,
    entryPoints: UriString[],
  ) => Promise<AppGraph>;
  /** Seam for tests: apply one file's change to a built graph. Defaults to `applyFileChange`. */
  applyChange?: (
    graph: AppGraph,
    uri: UriString,
    kind: FileChangeKind,
    fs: AbstractFileSystem,
  ) => Promise<void>;
}

/** A liquid file that can be an edge SOURCE — the build's entry points + fingerprint domain. */
function isEdgeSource(uri: UriString): boolean {
  return isLayout(uri) || isPage(uri) || isPartial(uri);
}

/** Real disk fingerprint: every edge-source liquid file → `mtimeMs:size`. */
async function computeFingerprintFromDisk(
  rootUri: UriString,
  fs: AbstractFileSystem,
): Promise<Fingerprint> {
  const uris = await recursiveReadDirectory(fs, rootUri, ([uri]) => isEdgeSource(uri));
  const fingerprint: Fingerprint = new Map();
  await Promise.all(
    uris.map(async (uri) => {
      try {
        const info = await stat(path.fsPath(uri));
        fingerprint.set(uri, `${info.mtimeMs}:${info.size}`);
      } catch {
        // Vanished between the walk and the stat — omit it; the next scan reconciles.
      }
    }),
  );
  return fingerprint;
}

function fingerprintsEqual(a: Fingerprint, b: Fingerprint): boolean {
  if (a.size !== b.size) return false;
  for (const [uri, value] of a) {
    if (b.get(uri) !== value) return false;
  }
  return true;
}

/**
 * The per-file changes between two fingerprints: a URI present only in `next` is
 * `added`, present only in `previous` is `deleted`, present in both with a
 * different value is `modified`. This is the exact input to `applyFileChange`.
 */
function diffFingerprints(
  previous: Fingerprint,
  next: Fingerprint,
): Array<[UriString, FileChangeKind]> {
  const changes: Array<[UriString, FileChangeKind]> = [];
  for (const [uri, value] of next) {
    const before = previous.get(uri);
    if (before === undefined) changes.push([uri, 'added']);
    else if (before !== value) changes.push([uri, 'modified']);
  }
  for (const uri of previous.keys()) {
    if (!next.has(uri)) changes.push([uri, 'deleted']);
  }
  return changes;
}

/**
 * A never-stale, lazily-built, background-refreshed cache of a project's
 * `AppGraph`. One instance per project root (created per server).
 */
export class GraphCache {
  private readonly rootUri: UriString;
  private readonly fs: AbstractFileSystem;
  private readonly computeFingerprint: (
    rootUri: UriString,
    fs: AbstractFileSystem,
  ) => Promise<Fingerprint>;
  private readonly buildGraph: (
    rootUri: UriString,
    fs: AbstractFileSystem,
    entryPoints: UriString[],
  ) => Promise<AppGraph>;
  private readonly applyChange: (
    graph: AppGraph,
    uri: UriString,
    kind: FileChangeKind,
    fs: AbstractFileSystem,
  ) => Promise<void>;

  /** The graph + the fingerprint of the disk it was built from / reconciled to. */
  private built: { graph: AppGraph; fingerprint: Fingerprint } | null = null;
  /** The in-flight background build, if any (dedup guard). */
  private inFlight: Promise<void> | null = null;
  /** The fingerprint of the most recent build ATTEMPT (success or failure). */
  private lastAttempt: Fingerprint | null = null;
  /** The error from the most recent failed build attempt, cleared on a new attempt. */
  private lastError: Error | null = null;
  /**
   * Serializes incremental reconciliations so concurrent lookups never interleave
   * mutations of the shared graph. Each stale lookup chains after the previous.
   */
  private reconcileChain: Promise<void> = Promise.resolve();

  constructor(options: GraphCacheOptions) {
    this.rootUri = options.rootUri;
    this.fs = options.fs ?? NodeFileSystem;
    this.computeFingerprint = options.computeFingerprint ?? computeFingerprintFromDisk;
    this.buildGraph =
      options.buildGraph ??
      ((rootUri, fs, entryPoints) => buildAppGraph(rootUri, { fs }, entryPoints));
    this.applyChange =
      options.applyChange ?? ((graph, uri, kind, fs) => applyFileChange(graph, uri, kind, { fs }));
  }

  /**
   * Return a FRESH graph for the current on-disk state. When the source is
   * unchanged since the last build/reconcile, serve the built graph directly.
   * When it moved and a graph exists, reconcile incrementally (apply only the
   * changed files) and serve the updated graph — no rebuild, no `computing` gap.
   * Only a cold start (no prior graph) returns without a graph, triggering a
   * background build. The fingerprint scan is cheap (a stat-scan); the request
   * path never awaits a full build.
   */
  async lookup(): Promise<GraphLookup> {
    const current = await this.computeFingerprint(this.rootUri, this.fs);

    if (this.built) {
      if (fingerprintsEqual(this.built.fingerprint, current)) {
        return { graph: this.built.graph };
      }
      return this.reconcileAndServe(current);
    }

    // Cold start: no prior graph to update incrementally → full build in the
    // background (Phase 2 will load a persisted graph here instead). If the
    // current source already failed to build and nothing is retrying it, it is
    // genuinely unavailable; otherwise a build is in flight.
    this.ensureBuild(current);
    const reason: 'recomputing' | 'unavailable' =
      this.lastError && !this.inFlight ? 'unavailable' : 'recomputing';
    return { graph: null, reason };
  }

  /**
   * Bring the built graph up to `target` by applying only the changed files, then
   * serve it fresh. Reconciliations are serialized (chained) so concurrent
   * lookups cannot interleave mutations of the shared graph; if incremental apply
   * fails, fall back to a full rebuild rather than serve a half-applied graph.
   */
  private reconcileAndServe(target: Fingerprint): Promise<GraphLookup> {
    const run = this.reconcileChain.then(() => this.applyDiff(target));
    // Keep the chain alive whatever this run's outcome (a rejection here is
    // recovered by fallbackToRebuild below; the chain must not stay rejected).
    this.reconcileChain = run.catch(() => undefined);
    return run.then(
      (): GraphLookup =>
        this.built ? { graph: this.built.graph } : { graph: null, reason: 'recomputing' },
      (): GraphLookup => this.fallbackToRebuild(target),
    );
  }

  /**
   * Apply the fingerprint diff (previous → `target`) to the built graph via
   * `applyChange`, then record `target` as the graph's fingerprint. Re-checks
   * under the chain lock so a queued reconcile that another run already caught up
   * to is a no-op; a rebuild that nulled the graph short-circuits.
   */
  private async applyDiff(target: Fingerprint): Promise<void> {
    const built = this.built;
    if (!built || fingerprintsEqual(built.fingerprint, target)) return;
    for (const [uri, kind] of diffFingerprints(built.fingerprint, target)) {
      await this.applyChange(built.graph, uri, kind, this.fs);
    }
    built.fingerprint = target;
  }

  /** Incremental apply failed → discard the graph and full-rebuild from scratch. */
  private fallbackToRebuild(target: Fingerprint): GraphLookup {
    this.built = null;
    this.lastError = null;
    this.lastAttempt = null;
    this.ensureBuild(target);
    return { graph: null, reason: 'recomputing' };
  }

  /**
   * Start a background build for `fingerprint` unless one is already running or
   * this exact source already failed (avoids a retry storm on an unbuildable
   * project — a changed fingerprint retries).
   */
  private ensureBuild(fingerprint: Fingerprint): void {
    if (this.inFlight) return;
    if (this.lastError && this.lastAttempt && fingerprintsEqual(this.lastAttempt, fingerprint)) {
      return;
    }

    this.lastAttempt = fingerprint;
    this.lastError = null;

    const entryPoints = [...fingerprint.keys()];
    this.inFlight = this.buildGraph(this.rootUri, this.fs, entryPoints)
      .then((graph) => {
        this.built = { graph, fingerprint };
      })
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  /**
   * Await the in-flight build and any queued incremental reconciliation. TEST/
   * warm-up hook only — the request path (`lookup`) never awaits a full build
   * (it does await its own incremental reconcile, which is fast).
   */
  async settle(): Promise<void> {
    await this.inFlight;
    await this.reconcileChain;
  }
}
