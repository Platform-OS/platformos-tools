import { AbstractFileSystem, App, Parsers, UriString } from '@platformos/platformos-common';

import { NodeFileSystem } from './NodeFileSystem';

/**
 * The `App` this process is serving, the project it belongs to, and what each file
 * it has read looked like at the moment it read it.
 *
 * Building one per lint run was, after TASK-12.22 pruned the walk, most of what a
 * warm `validate_code` call still paid for: 67-83 ms of a ~100 ms call on a
 * 3139-file project, of which the walk itself is only ~35 ms — the rest is
 * classifying 3139 paths and rebuilding both indexes to produce an object identical
 * to the one the previous call threw away, along with every source and AST it had
 * lazily loaded.
 *
 * Holding one per process removes that. The reconciliation below is what makes it
 * safe in a process that gets NO filesystem events: the candidate paths are walked
 * again on every call — that part is not cacheable, because an agent editing files
 * out of band is exactly the case this has to be correct for — and the app is
 * brought in line with them, rather than rebuilt from them.
 */
let shared: SharedApp | undefined;

interface SharedApp {
  rootUri: UriString;
  app: App;
  /** Per-file `mtime:size` as of the moment its source was read, or {@link UNKNOWN}. */
  fingerprints: Map<UriString, string>;
}

/**
 * Recorded for a file whose state cannot be established — a filesystem that reports
 * no modification time, a file that vanished. It never equals a real fingerprint, so
 * such a file is re-read on the next run rather than trusted.
 */
const UNKNOWN = 'unknown';

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
 * Three things can have changed since the previous call, and each is handled where
 * it is cheapest:
 *
 * - **Added / deleted files** — from the walk, which every call does anyway. Files
 *   the walk no longer sees are dropped; files it has not classified yet are added.
 *   Everything else keeps its identity, its place in the name index, and whatever it
 *   had read.
 * - **Edited files** — `stat` per file whose source is IN MEMORY, which is the
 *   handful a single-file lint reached through `{% render %}`, not the project. A
 *   file nobody has read cannot be stale, so it costs nothing to leave alone.
 * - **Unsaved buffers** — left exactly as they are. A buffer that is not on disk yet
 *   must not be deleted by a walk that cannot see it, and its content, not the
 *   file's, is the authority on itself.
 *
 * The one file this deliberately does not revalidate is one carrying a buffer, for
 * the same reason: it is newer than anything on disk by construction.
 */
export async function getSharedApp(
  rootUri: UriString,
  paths: readonly UriString[],
  parsers: Parsers,
): Promise<App> {
  if (shared?.rootUri !== rootUri) {
    const fingerprints = new Map<UriString, string>();
    const app = App.fromPaths(rootUri, paths, recordingFileSystem(fingerprints), parsers);
    shared = { rootUri, app, fingerprints };
    return app;
  }

  const { app, fingerprints } = shared;
  reconcilePaths(app, paths, fingerprints);
  await revalidateLoaded(app, fingerprints);
  evictOverCap(app, fingerprints);
  return app;
}

/**
 * How many files keep the source and AST they read once the call that read them is
 * over.
 *
 * An app that lives as long as the process would otherwise accumulate every file
 * anyone ever linted, and a Liquid AST is ~0.25 MB: 300 calls across a real project
 * measured 450 retained files and +112 MB of RSS over the same calls with the app
 * rebuilt each time. The ceiling without a cap is the whole project — the very cost
 * the lazy model exists to avoid paying.
 *
 * A single-file lint loads under 10 files (the buffer plus what it renders), so this
 * is more than twenty calls' worth of working set. Eviction is by first-read order
 * rather than true LRU — there is no signal for "used", only for "read" — and getting
 * it wrong costs one re-read of a small file.
 */
export const MAX_RETAINED_FILES = 200;

/** Drop the oldest retained sources once more than {@link MAX_RETAINED_FILES} are held. */
function evictOverCap(app: App, fingerprints: Map<UriString, string>): void {
  let excess = fingerprints.size - MAX_RETAINED_FILES;
  if (excess <= 0) return;

  for (const uri of fingerprints.keys()) {
    if (excess-- <= 0) break;
    app.invalidate(uri);
    fingerprints.delete(uri);
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
  // Both sides are already in the one spelling the toolchain compares on — the walk
  // normalizes its paths, `AppFile` normalizes its URI — so this is a string
  // comparison. Asking `app.has()` per path instead re-parses every URI in the
  // project on every call: 20-40 ms of pure `vscode-uri` work on a 3139-file app,
  // which is most of what reconciling was supposed to save.
  const known = new Set(files.map((file) => file.uri));

  // Candidates the app rejects — a path in no platformOS directory — are never
  // "in" it, so they are re-offered on every call. That is a handful of failed
  // regex matches, and the alternative is a second opinion about what the app
  // contains, which is the thing `App.fromPaths` exists to be the only one of.
  const added = paths.filter((uri) => !known.has(uri));
  const removed = files
    .filter((file) => !walked.has(file.uri) && file.version === undefined)
    .map((file) => file.uri);

  if (added.length > 0) app.update(added);
  if (removed.length > 0) {
    app.remove(removed);
    // A deleted file holds nothing, so it must stop counting towards the retention
    // cap — otherwise a project that churns files evicts live ones to make room for
    // the memory of dead ones.
    for (const uri of removed) fingerprints.delete(uri);
  }
}

/** Drop the cached source and AST of every in-memory file that has since changed on disk. */
async function revalidateLoaded(app: App, fingerprints: Map<UriString, string>): Promise<void> {
  const inMemory = app.all().filter((file) => file.loaded && file.version === undefined);

  await Promise.all(
    inMemory.map(async (file) => {
      const current = await fingerprintOf(file.uri);
      if (current !== UNKNOWN && fingerprints.get(file.uri) === current) return;
      app.invalidate(file.uri);
      fingerprints.delete(file.uri);
    }),
  );
}

/**
 * `NodeFileSystem`, plus a note of what each file looked like when it was read.
 *
 * The `stat` is taken BEFORE the read, so a write that lands between the two is
 * recorded as a change rather than swallowed by it: the fingerprint can only ever
 * be older than the content it labels, which makes revalidation conservative — it
 * can re-read a file that did not need it, never trust one that did.
 */
function recordingFileSystem(fingerprints: Map<UriString, string>): AbstractFileSystem {
  return {
    stat: (uri) => NodeFileSystem.stat(uri),
    readDirectory: (uri) => NodeFileSystem.readDirectory(uri),
    async readFile(uri) {
      const before = await fingerprintOf(uri);
      const source = await NodeFileSystem.readFile(uri);
      fingerprints.set(uri, before);
      return source;
    },
  };
}

async function fingerprintOf(uri: UriString): Promise<string> {
  try {
    const stat = await NodeFileSystem.stat(uri);
    return stat.mtimeMs === undefined ? UNKNOWN : `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return UNKNOWN;
  }
}
