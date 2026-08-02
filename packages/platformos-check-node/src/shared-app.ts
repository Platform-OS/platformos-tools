import { App, Parsers, UriString } from '@platformos/platformos-common';

import { UNKNOWN, fingerprintOf } from './fingerprints';
import { NodeFileSystem } from './NodeFileSystem';

/**
 * The `App` this process is serving, the project it belongs to, and what each file it
 * has read looked like at the moment revalidation last saw it.
 *
 * One app per process, reconciled rather than rebuilt. The candidate paths are walked
 * again on every call — that part is not cacheable, because a process with no
 * filesystem events (an agent editing files out of band) has no other way to learn
 * what changed — and the app is brought in line with them.
 */
let shared: SharedApp | undefined;

interface SharedApp {
  rootUri: UriString;
  app: App;
  /**
   * Per-file `mtime:size` baseline, established by {@link revalidateLoaded} — NOT by
   * the read. A `stat` before every read would double the filesystem round trips of
   * every whole-project command to buy a baseline a one-shot process never consults.
   */
  fingerprints: Map<UriString, string>;
}

/**
 * Forget the shared app so the next lint run builds one from the project currently
 * on disk.
 *
 * Reconciliation already keeps the app honest about added, changed and deleted
 * files, so this is for embedders that replace the project under a running process
 * by other means — and for tests.
 */
export function resetSharedApp(): void {
  shared = undefined;
}

/**
 * The process's app for `rootUri`, reconciled against the candidate `paths` this
 * call walked.
 *
 * Three things can have changed since the previous call, each handled where it is
 * cheapest:
 *
 * - **Added / deleted files** — from the walk, which every call does anyway. Everything
 *   else keeps its identity, its place in the name index, and whatever it had read.
 * - **Edited files** — `stat` per file whose source is IN MEMORY, which is the handful a
 *   single-file lint reached through `{% render %}`, not the project. A file nobody has
 *   read cannot be stale.
 * - **Unsaved buffers** — left alone by both rules: a buffer is newer than anything on
 *   disk by construction, and a walk that cannot see it must not delete it.
 */
export async function getSharedApp(
  rootUri: UriString,
  paths: readonly UriString[],
  parsers: Parsers,
): Promise<App> {
  if (shared?.rootUri !== rootUri) {
    const app = App.fromPaths(rootUri, paths, NodeFileSystem, parsers);
    shared = { rootUri, app, fingerprints: new Map() };
    return app;
  }

  const { app, fingerprints } = shared;
  reconcilePaths(app, paths, fingerprints);
  await revalidateLoaded(app, fingerprints);
  evictOverCap(app, fingerprints);
  return app;
}

/**
 * How many files keep the source and AST they read once the call that read them is over.
 *
 * Without a cap a process-lifetime app accumulates every file anyone ever linted, up to
 * the whole project — the cost the lazy model exists to avoid. A single-file lint loads
 * under 10 files, so this is more than twenty calls' worth of working set.
 *
 * Eviction is in `AppFile.lastTouch` order, NOT first-read order: an agent revalidating
 * one file in a loop keeps re-touching that file's render targets, which are among the
 * earliest reads of the process, so read order would evict exactly the working set.
 */
export const MAX_RETAINED_FILES = 200;

/** Drop the least-recently-used retained sources once more than {@link MAX_RETAINED_FILES} are held. */
function evictOverCap(app: App, fingerprints: Map<UriString, string>): void {
  const retained = app.all().filter((file) => file.loaded && file.version === undefined);
  const excess = retained.length - MAX_RETAINED_FILES;
  if (excess <= 0) return;

  retained.sort((a, b) => a.lastTouch - b.lastTouch);
  for (const file of retained.slice(0, excess)) {
    app.invalidate(file.uri);
    fingerprints.delete(file.uri);
  }
}

/** Bring the app's file set in line with what the walk just found. */
function reconcilePaths(
  app: App,
  paths: readonly UriString[],
  fingerprints: Map<UriString, string>,
): void {
  const walked = new Set(paths);
  const files = app.all();
  // Both sides are already normalized, so this is a string comparison. Asking
  // `app.has()` per path re-parses every URI in the project on every call.
  const known = new Set(files.map((file) => file.uri));

  // Candidates the app rejects — a path in no platformOS directory — are never "in" it,
  // so they are re-offered every call. That is a few failed regex matches, and the
  // alternative is a second opinion about what the app contains.
  const added = paths.filter((uri) => !known.has(uri));
  const removed = files
    .filter((file) => !walked.has(file.uri) && file.version === undefined)
    .map((file) => file.uri);

  if (added.length > 0) app.update(added);
  if (removed.length > 0) {
    app.remove(removed);
    // A deleted file's baseline must go with it — otherwise a path that comes BACK
    // could match a fingerprint recorded for the file that used to be there.
    for (const uri of removed) fingerprints.delete(uri);
  }
}

/**
 * Drop the cached source and AST of every in-memory file that has since changed on
 * disk — or whose freshness cannot be vouched for yet.
 *
 * The baseline is established HERE, on the first revalidation after a read, not by the
 * read itself. The price is one conservative re-read per file: a file first read on call
 * N has no baseline yet, so call N+1 drops it and re-reads if it still needs it. From
 * then on it is kept until its `mtime`/`size` move.
 *
 * The baseline is always recorded BEFORE the re-read that follows it, so a write landing
 * between the two fails the next comparison — revalidation can re-read a file that did
 * not need it, never trust one that did.
 */
async function revalidateLoaded(app: App, fingerprints: Map<UriString, string>): Promise<void> {
  const inMemory = app.all().filter((file) => file.loaded && file.version === undefined);

  await Promise.all(
    inMemory.map(async (file) => {
      const current = await fingerprintOf(file.uri);
      // Re-read the version AFTER the await: a concurrent call can overlay a buffer
      // while the stat is in flight, and invalidating would silently lint the on-disk
      // content instead.
      if (file.version !== undefined) return;
      if (current !== UNKNOWN && fingerprints.get(file.uri) === current) return;
      app.invalidate(file.uri);
      if (current === UNKNOWN) {
        fingerprints.delete(file.uri);
      } else {
        fingerprints.set(file.uri, current);
      }
    }),
  );
}
