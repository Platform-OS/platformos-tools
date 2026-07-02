/**
 * Project-graph cache at the supervisor I/O edge.
 *
 * The full `AppGraph` is expensive to build (a whole-project parse), so it is
 * built ONCE and reused across `validate_code` calls — but NEVER served stale.
 * Staleness would mislead the agent (e.g. "nothing depends on this, safe to
 * change" when a caller was added since the build), so the cache is
 * fingerprint-validated on every request: it serves the graph only when the
 * on-disk source it was built from is unchanged, and otherwise reports
 * "recomputing" (triggering a background rebuild) rather than handing back a
 * possibly-wrong answer.
 *
 * The build is fired in the background and NEVER awaited on the request path —
 * blast-radius is a secondary signal and must not add latency to, or ever sink,
 * the primary lint gate (mirrors the `runValidateCode` degrade contract).
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
import { buildAppGraph, type AppGraph } from '@platformos/platformos-graph';

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

  /** The graph + the fingerprint of the disk it was built from. */
  private built: { graph: AppGraph; fingerprint: Fingerprint } | null = null;
  /** The in-flight background build, if any (dedup guard). */
  private inFlight: Promise<void> | null = null;
  /** The fingerprint of the most recent build ATTEMPT (success or failure). */
  private lastAttempt: Fingerprint | null = null;
  /** The error from the most recent failed build attempt, cleared on a new attempt. */
  private lastError: Error | null = null;

  constructor(options: GraphCacheOptions) {
    this.rootUri = options.rootUri;
    this.fs = options.fs ?? NodeFileSystem;
    this.computeFingerprint = options.computeFingerprint ?? computeFingerprintFromDisk;
    this.buildGraph =
      options.buildGraph ??
      ((rootUri, fs, entryPoints) => buildAppGraph(rootUri, { fs }, entryPoints));
  }

  /**
   * Return the graph ONLY if it is fresh (the on-disk source is unchanged since
   * the build); otherwise trigger a background rebuild and report why no graph
   * is available. Cheap (a stat-scan) and NON-BLOCKING — never awaits the build.
   */
  async lookup(): Promise<GraphLookup> {
    const current = await this.computeFingerprint(this.rootUri, this.fs);

    if (this.built && fingerprintsEqual(this.built.fingerprint, current)) {
      return { graph: this.built.graph };
    }

    this.ensureBuild(current);
    // Not fresh: a build is (or was) needed. If the current source already failed
    // to build and nothing is retrying it, it is genuinely unavailable; otherwise
    // a build is in flight.
    const reason: 'recomputing' | 'unavailable' =
      this.lastError && !this.inFlight ? 'unavailable' : 'recomputing';
    return { graph: null, reason };
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
   * Await the in-flight build, if any. TEST/warm-up hook only — the request path
   * (`lookup`) never awaits a build.
   */
  async settle(): Promise<void> {
    await this.inFlight;
  }
}
