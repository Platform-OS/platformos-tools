import { App, Parsers, UriString } from '@platformos/platformos-common';

import { UNKNOWN, fingerprintOf, fingerprintOfStat } from './fingerprints';
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
 *
 * `maxRetainedFiles` is the retention cap this call evicts down to, defaulting to the
 * shipped {@link MAX_RETAINED_FILES}. It is a parameter rather than a constant read here so
 * that the eviction RULES can be pinned at a fixture size every platform can afford: sizing
 * a fixture to the shipped cap costs 10 000 files, which is past the 8192 descriptors
 * Windows allows a process.
 */
export async function getSharedApp(
  rootUri: UriString,
  paths: readonly UriString[],
  parsers: Parsers,
  maxRetainedFiles: number = MAX_RETAINED_FILES,
): Promise<App> {
  if (shared?.rootUri !== rootUri) {
    const app = App.fromPaths(rootUri, paths, NodeFileSystem, parsers);
    shared = { rootUri, app, fingerprints: new Map() };
    return app;
  }

  const { app, fingerprints } = shared;
  reconcilePaths(app, paths, fingerprints);
  await revalidateLoaded(app, fingerprints);
  evictOverCap(app, fingerprints, maxRetainedFiles);
  return app;
}

/**
 * How many files keep the source and AST they read once the call that read them is over.
 *
 * A cap has to exist — without one a process-lifetime app accumulates the whole project —
 * but it is sized for the largest project a process might sweep, not for the working set of
 * one call: a retained file holds its source and AST at ~33 KB, so a 1509-file project costs
 * +21 MB of heap and a 6027-file one +200 MB. Below that, a repeated whole-project lint is
 * evicted out of any reuse and re-parses everything, and parsing is 56% of the run.
 *
 * The per-call price of raising it is {@link revalidateLoaded}'s `stat` sweep over whatever
 * is retained, ~21 us per file — ~200 ms for a fully retained 10 000-file project.
 *
 * Eviction is in `AppFile.lastTouch` order, NOT first-read order: an agent revalidating
 * one file in a loop keeps re-touching that file's render targets, which are among the
 * earliest reads of the process, so read order would evict exactly the working set.
 */
export const MAX_RETAINED_FILES = 10_000;

/** Drop the least-recently-used retained sources once more than `cap` are held. */
function evictOverCap(app: App, fingerprints: Map<UriString, string>, cap: number): void {
  const retained = app.all().filter((file) => file.loaded && file.version === undefined);
  const excess = retained.length - cap;
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
 * disk — or whose freshness cannot be vouched for.
 *
 * The baseline comes from the READ: `AppFile` stats each file immediately before reading it
 * and keeps that as `loadedStat`, so a file read on call N is already vouched for when call
 * N+1 asks, and is KEPT rather than dropped. A baseline never describes a state NEWER than
 * the content it vouches for, which is what makes trusting it safe (see `AppFile.loadedStat`):
 * revalidation can re-read a file that did not need it, never trust one that did.
 */
async function revalidateLoaded(app: App, fingerprints: Map<UriString, string>): Promise<void> {
  const inMemory = app.all().filter((file) => file.loaded && file.version === undefined);

  await Promise.all(
    inMemory.map(async (file) => {
      // The map is the running baseline, seeded by the file's own pre-read stat for a file
      // that has not been revalidated yet; `UNKNOWN` never equals a real fingerprint, so a
      // file with neither still falls through to the re-read. Map first is the conservative
      // half: a map entry can only be OLDER than the read's own stat, so preferring it can
      // cost a needless re-read and can never trust content it should not.
      const baseline = fingerprints.get(file.uri) ?? fingerprintOfStat(file.loadedStat);
      const current = await fingerprintOf(file.uri);
      // Re-read the version AFTER the await: a concurrent call can overlay a buffer
      // while the stat is in flight, and invalidating would silently lint the on-disk
      // content instead.
      if (file.version !== undefined) return;
      if (current !== UNKNOWN && baseline === current) {
        fingerprints.set(file.uri, current);
        return;
      }
      app.invalidate(file.uri);
      if (current === UNKNOWN) {
        fingerprints.delete(file.uri);
      } else {
        fingerprints.set(file.uri, current);
      }
    }),
  );
}
