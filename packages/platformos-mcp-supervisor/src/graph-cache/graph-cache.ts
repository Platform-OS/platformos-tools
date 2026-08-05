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
 * COLD start (no in-memory graph) is warmed from a PERSISTED graph when one is
 * available (TASK-9.15 Phase 2): the cache loads the serialized graph + its
 * fingerprint and reconciles the on-disk delta incrementally, instead of a full
 * ~22s build. The graph is persisted (off the request path, coalesced) after each
 * build and reconcile, so a restart resumes near-instantly. A missing / corrupt /
 * wrong-version / wrong-root cache simply falls back to a full build — the
 * fingerprint still gates correctness after load, so a stale cache converges to
 * fresh and a bad one never yields a wrong answer. Either way the cold work runs
 * in the background and is NEVER awaited on the request path — blast-radius is a
 * secondary signal and must not add latency to, or ever sink, the primary lint
 * gate (mirrors the `runValidateCode` degrade contract).
 *
 * Fingerprint domain = the liquid files that are edge SOURCES (page/layout/
 * partial+lib). Only their add/remove/modify can change any file's dependents;
 * `.graphql`/`.yml`/asset files are leaves. This is also exactly the set fed to
 * `buildAppGraph` as entry points, so dependents are COMPLETE (every caller is
 * traversed) — see the query.ts note on entry-point scope.
 *
 * The cache is a PURE CONSUMER of the graph's canonical `enumerateEdgeSources`
 * (TASK-9.17): the "which files are edge sources" + "where sources live"
 * definitions live in platformos-graph beside the classifier, so this cache can
 * never drift from them. The enumeration is scoped to the platformOS source roots
 * (a bundled `react-app/` is never walked; identical set, cheaper — TASK-9.15
 * Phase 3A).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { path, type UriString } from '@platformos/platformos-check-common';
import {
  fingerprintOf,
  isKnownFingerprint,
  NodeFileSystem,
} from '@platformos/platformos-check-node';
import type { AbstractFileSystem } from '@platformos/platformos-common';
import {
  applyFileChange,
  buildAppGraph,
  enumerateEdgeSources,
  type AppGraph,
  type FileChangeKind,
} from '@platformos/platformos-graph';

import { decodeCacheFile, encodeCacheFile, type Fingerprint } from './graph-cache-store.js';

/** The result of asking the cache for a usable graph. */
export type GraphLookup =
  { graph: AppGraph } | { graph: null; reason: 'recomputing' | 'unavailable' };

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
  /**
   * Absolute path of the on-disk cache file. When set, the cache is warmed from
   * it on cold start and persisted to it after builds/reconciles. Omit to disable
   * persistence (pure in-memory). See {@link defaultGraphCachePath}.
   */
  cachePath?: string;
  /** Seam for tests: read the cache file (`null` when absent/unreadable). Defaults to reading `cachePath`. */
  readCacheFile?: () => Promise<string | null>;
  /** Seam for tests: write the cache file (atomically). Defaults to an atomic write to `cachePath`. */
  writeCacheFile?: (contents: string) => Promise<void>;
}

/**
 * The default per-project cache-file path: a stable, project-root-derived name in
 * the OS temp dir. Temp is fine — the cache is a rebuildable derivative, and a
 * missing file just triggers a full build. One file per root (hashed) so distinct
 * projects never collide.
 */
export function defaultGraphCachePath(rootUri: UriString): string {
  const hash = createHash('sha256').update(rootUri).digest('hex').slice(0, 16);
  return join(tmpdir(), 'platformos-mcp-supervisor', `graph-${hash}.json`);
}

/** Read a file as UTF-8, or `null` if it does not exist / cannot be read. */
async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Write a file atomically (temp + rename) so a reader never observes a partial write. */
async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, filePath);
}

/**
 * Real disk fingerprint: every edge-source liquid file → its per-file identity.
 *
 * Reuses check-node's exported {@link fingerprintOf} — the SAME `mtime:ctime:size`
 * definition its shared `App` and shared `RouteTable` revalidate against — so the
 * never-stale caches in this process can never disagree about what "changed" means. It
 * takes a URI, which is what this cache already holds, so nothing converts to a
 * filesystem path and back on the way in.
 *
 * A file whose state cannot be established — in practice one that vanished between the
 * enumeration and the stat — fails {@link isKnownFingerprint} and is OMITTED rather than
 * recorded. Recording it would be the worse of the two: the "cannot tell" value equals
 * itself, so two scans that both failed to read a file would compare equal and report it
 * unchanged forever. Omission instead reconciles it as `deleted` on this scan and `added`
 * on the first scan that can read it, which is the truth in both directions.
 */
async function computeFingerprintFromDisk(
  rootUri: UriString,
  fs: AbstractFileSystem,
): Promise<Fingerprint> {
  const uris = await enumerateEdgeSources(fs, rootUri);
  const fingerprint: Fingerprint = new Map();
  await Promise.all(
    uris.map(async (uri) => {
      const identity = await fingerprintOf(uri);
      if (isKnownFingerprint(identity)) fingerprint.set(uri, identity);
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
  /** Read the persisted cache file, or `null` if persistence is disabled/absent. */
  private readonly readCacheFile: (() => Promise<string | null>) | null;
  /** Write the persisted cache file, or `null` if persistence is disabled. */
  private readonly writeCacheFile: ((contents: string) => Promise<void>) | null;

  /** The graph + the fingerprint of the disk it was built from / reconciled to. */
  private built: { graph: AppGraph; fingerprint: Fingerprint } | null = null;
  /** The in-flight background build/hydrate, if any (dedup guard). */
  private inFlight: Promise<void> | null = null;
  /** The fingerprint of the most recent build ATTEMPT (success or failure). */
  private lastAttempt: Fingerprint | null = null;
  /** The error from the most recent failed build attempt, cleared on a new attempt. */
  private lastError: Error | null = null;
  /** Whether the one-shot persisted-cache load has been attempted (cold start only). */
  private loadAttempted = false;
  /**
   * Serializes incremental reconciliations so concurrent lookups never interleave
   * mutations of the shared graph. Each stale lookup chains after the previous.
   */
  private reconcileChain: Promise<void> = Promise.resolve();
  /**
   * Number of reconciliations queued-or-running. The synchronous fast path serves
   * `built.graph` ONLY when this is 0, so a lookup can never read the graph while
   * `applyDiff` is mutating it in place across `await`s (a half-applied graph must
   * never be served — the never-stale mandate). When >0, a lookup routes through
   * the chain and serves the fully-reconciled graph.
   */
  private reconciling = 0;
  /** Set when the built graph changed and still needs persisting; the running/next drain flushes it. */
  private persistDirty = false;
  /** The in-flight persist drain, if any — so a burst (and changes landing mid-write) coalesce. */
  private persistDrain: Promise<void> | null = null;

  constructor(options: GraphCacheOptions) {
    this.rootUri = options.rootUri;
    this.fs = options.fs ?? NodeFileSystem;
    this.computeFingerprint = options.computeFingerprint ?? computeFingerprintFromDisk;
    this.buildGraph =
      options.buildGraph ??
      ((rootUri, fs, entryPoints) => buildAppGraph(rootUri, { fs }, entryPoints));
    this.applyChange =
      options.applyChange ?? ((graph, uri, kind, fs) => applyFileChange(graph, uri, kind, { fs }));

    const cachePath = options.cachePath;
    this.readCacheFile =
      options.readCacheFile ?? (cachePath ? () => readFileOrNull(cachePath) : null);
    this.writeCacheFile =
      options.writeCacheFile ??
      (cachePath ? (contents) => writeFileAtomic(cachePath, contents) : null);
  }

  /**
   * Return a FRESH graph for the current on-disk state. When the source is
   * unchanged since the last build/reconcile AND no reconcile is in flight, serve
   * the built graph directly (the synchronous fast path). When it moved (or a
   * reconcile is running) and a graph exists, reconcile incrementally through the
   * serialized chain and serve the updated graph — no rebuild, no `computing` gap.
   * Only a cold start (no prior graph) returns without a graph, triggering a
   * background build. The fingerprint scan is cheap (a stat-scan); the request
   * path never awaits a full build.
   */
  /**
   * Begin producing the graph NOW, off the request path, and resolve once that
   * attempt has settled.
   *
   * `lookup` already builds in the background on a cold start — but only once a
   * request arrives, so the entire cold cost (persisted-cache load, else a full
   * build) lands on the FIRST request. Node being single-threaded, the lint
   * sharing that tick is starved by it: a first `validate_code` measured 46–58 s
   * on a project whose warm calls are ~1 s, against a 37 s standalone build. The
   * contention is the cost, not the build alone.
   *
   * Called at server start, this moves the work BEFORE the first request instead
   * of underneath it. It does not make the build cheaper — see TASK-12.8 for that.
   *
   * NEVER REJECTS, so callers can fire-and-forget without risking an unhandled
   * rejection: a failed build is recorded internally exactly as if a request had
   * triggered it (`lookup` then reports `unavailable`), and a failed fingerprint
   * scan is left for the next `lookup` to retry.
   *
   * Idempotent and cheap to over-call: a concurrent build is joined rather than
   * duplicated (`ensureGraph`'s in-flight guard), and it is a no-op once a graph
   * exists. It deliberately does NOT reconcile an existing graph — that is
   * `lookup`'s job on the request path, where freshness is required.
   */
  async warm(): Promise<void> {
    if (this.built) return;

    let fingerprint: Fingerprint;
    try {
      fingerprint = await this.computeFingerprint(this.rootUri, this.fs);
    } catch {
      // The scan itself failed (e.g. the root is not readable yet). Nothing to
      // record — the next `lookup` retries from scratch.
      return;
    }

    // A request may have won the race while the scan was in flight; building
    // again would be wasted work.
    if (this.built) return;

    this.ensureGraph(fingerprint);
    // Settle rather than just awaiting the build: it also drains the persist
    // write, so once this resolves the on-disk cache reflects the warm-up and a
    // restart resumes from it. Every promise `settle` awaits has already absorbed
    // its own rejection, so this cannot throw.
    await this.settle();
  }

  async lookup(): Promise<GraphLookup> {
    const current = await this.computeFingerprint(this.rootUri, this.fs);

    if (this.built) {
      // Fast path: serve directly only when nothing is reconciling — otherwise
      // `built.graph` may be mid-mutation (applyDiff mutates in place across
      // `await`s). `this.reconciling === 0` + the synchronous return (no `await`
      // before it) guarantees the served graph is complete.
      if (this.reconciling === 0 && fingerprintsEqual(this.built.fingerprint, current)) {
        return { graph: this.built.graph };
      }
      return this.reconcileAndServe(current);
    }

    // Cold start: no in-memory graph → warm from the persisted cache or full-build
    // in the background. If the current source already failed and nothing is
    // retrying it, it is genuinely unavailable; otherwise work is in flight.
    this.ensureGraph(current);
    const reason: 'recomputing' | 'unavailable' =
      this.lastError && !this.inFlight ? 'unavailable' : 'recomputing';
    return { graph: null, reason };
  }

  /**
   * Reconcile the built graph to the current disk state through the serialized
   * chain, then serve it fresh. Reconciliations are chained so concurrent lookups
   * never interleave mutations of the shared graph, and `reconciling` keeps the
   * fast path off `built.graph` while any apply is pending. If incremental apply
   * fails, fall back to a full rebuild rather than serve a half-applied graph.
   *
   * `fallbackFingerprint` (the caller's observed scan) is used only to seed a
   * rebuild if apply throws; the reconcile itself re-reads disk (see
   * {@link applyDiff}), so it always converges to the ACTUAL current state
   * regardless of chain-arrival order.
   */
  private reconcileAndServe(fallbackFingerprint: Fingerprint): Promise<GraphLookup> {
    this.reconciling++;
    const run = this.reconcileChain.then(() => this.applyDiff());
    // Keep the chain alive whatever this run's outcome (a rejection here is
    // recovered by fallbackToRebuild below; the chain must not stay rejected).
    this.reconcileChain = run.catch(() => undefined).finally(() => this.reconciling--);
    return run.then(
      (): GraphLookup =>
        this.built ? { graph: this.built.graph } : { graph: null, reason: 'recomputing' },
      (): GraphLookup => this.fallbackToRebuild(fallbackFingerprint),
    );
  }

  /**
   * Reconcile the built graph to the CURRENT on-disk state and record it. Re-reads
   * the fingerprint fresh (rather than trusting the caller's earlier scan), so a
   * reconcile always moves the graph toward the actual current disk — never a
   * backward diff when reconciles resolve out of order under concurrency. A no-op
   * when already current, or when a rebuild nulled the graph.
   */
  private async applyDiff(): Promise<void> {
    const built = this.built;
    if (!built) return;
    const target = await this.computeFingerprint(this.rootUri, this.fs);
    if (fingerprintsEqual(built.fingerprint, target)) return;
    for (const [uri, kind] of diffFingerprints(built.fingerprint, target)) {
      await this.applyChange(built.graph, uri, kind, this.fs);
    }
    built.fingerprint = target;
    // Advance the on-disk cache so a restart resumes from here (small delta).
    this.schedulePersist();
  }

  /** Incremental apply failed → discard the graph and full-rebuild from scratch. */
  private fallbackToRebuild(fingerprint: Fingerprint): GraphLookup {
    this.built = null;
    this.lastError = null;
    this.lastAttempt = null;
    this.ensureGraph(fingerprint);
    return { graph: null, reason: 'recomputing' };
  }

  /**
   * Ensure a graph is being produced in the background for `fingerprint` — warmed
   * from the persisted cache on the first cold attempt, else full-built — unless
   * one is already running or this exact source already failed (avoids a retry
   * storm on an unbuildable project; a changed fingerprint retries).
   */
  private ensureGraph(fingerprint: Fingerprint): void {
    if (this.inFlight) return;
    if (this.lastError && this.lastAttempt && fingerprintsEqual(this.lastAttempt, fingerprint)) {
      return;
    }

    this.lastAttempt = fingerprint;
    this.lastError = null;

    this.inFlight = this.hydrate(fingerprint)
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.inFlight = null;
      });
  }

  /**
   * Produce the graph: on the FIRST cold attempt, try the persisted cache (loaded
   * graph + its fingerprint — `lookup` then reconciles the delta vs the current
   * disk); otherwise, or if no usable cache exists, full-build over the current
   * entry points and persist the result. A load failure/absence falls through to
   * a build, so a bad cache never blocks startup.
   */
  private async hydrate(fingerprint: Fingerprint): Promise<void> {
    if (!this.loadAttempted) {
      this.loadAttempted = true;
      const loaded = await this.tryLoad();
      if (loaded) {
        this.built = loaded;
        return;
      }
    }

    const graph = await this.buildGraph(this.rootUri, this.fs, [...fingerprint.keys()]);
    this.built = { graph, fingerprint };
    this.schedulePersist();
  }

  /** Load + decode the persisted cache, or `null` if disabled/absent/unusable. */
  private async tryLoad(): Promise<{ graph: AppGraph; fingerprint: Fingerprint } | null> {
    if (!this.readCacheFile) return null;
    const text = await this.readCacheFile();
    return text !== null ? decodeCacheFile(text, this.rootUri) : null;
  }

  /**
   * Persist the current graph off the request path. Coalesced: a single drain
   * writes the LATEST built state, and any change that lands while a write is
   * in-flight is flushed by exactly one follow-up write (never a partial/older
   * one, never one write per change in a burst).
   */
  private schedulePersist(): void {
    if (!this.writeCacheFile) return;
    this.persistDirty = true;
    // A drain is already running; it re-checks `persistDirty` after each write, so
    // the change now flagged is picked up without enqueuing a redundant write.
    if (this.persistDrain) return;
    this.persistDrain = this.drainPersist().finally(() => {
      this.persistDrain = null;
    });
  }

  /** Write the latest built state, looping once more if a change landed during the write. */
  private async drainPersist(): Promise<void> {
    while (this.persistDirty) {
      this.persistDirty = false;
      await this.writeCurrent();
    }
  }

  /** Serialize + write the current built graph; best-effort (a write failure never breaks the cache). */
  private async writeCurrent(): Promise<void> {
    const built = this.built;
    if (!built || !this.writeCacheFile) return;
    try {
      await this.writeCacheFile(encodeCacheFile(this.rootUri, built.graph, built.fingerprint));
    } catch {
      // Persistence is best-effort: the next successful build/reconcile
      // re-persists, and correctness is gated by the fingerprint regardless.
    }
  }

  /**
   * Await the in-flight build/hydrate, any queued incremental reconciliation, and
   * any pending cache write. TEST/warm-up hook only — the request path (`lookup`)
   * never awaits a full build (it does await its own incremental reconcile, which
   * is fast).
   */
  async settle(): Promise<void> {
    await this.inFlight;
    await this.reconcileChain;
    await this.persistDrain;
  }
}
