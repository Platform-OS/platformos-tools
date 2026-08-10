import {
  Config,
  GraphQLSourceCode,
  JSONSourceCode,
  LiquidSourceCode,
  Offense,
  toSourceCode as commonToSourceCode,
  check as coreCheck,
  isIgnored,
  sourceParsers,
  UriString,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';
import {
  App as AppModel,
  Parsers,
  SOURCE_FILE_EXTENSIONS,
  sourceCodeTypeOf,
  uriFromPath,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import {
  PlatformOSLiquidDocsManager,
  downloadPlatformOSLiquidDocs,
  root as platformOSLiquidDocsRoot,
} from '@platformos/platformos-check-docs-updater';
import fs from 'node:fs/promises';

import { autofix } from './autofix';
import { findConfigPath, loadConfig as resolveConfig } from './config';
import { makeGetDocDefinition } from './doc-definitions';
import { NodeFileSystem } from './NodeFileSystem';
import { getSharedRouteTable, resetRouteTable } from './route-table';
import { getSharedApp, resetSharedApp } from './shared-app';

/**
 * Deliberately re-exported EXPLICITLY, because the `export *` below carries an `autofix` of
 * its own and an explicit re-export shadows a star one — measured, in either source order,
 * since the local binding is hoisted ahead of `__exportStar`'s own-property check. See
 * `./autofix` for which one has to win and why. It is a strict superset of check-common's, so
 * nothing else needs re-exporting to reach that behaviour.
 */
export { autofix, saveToDiskFixApplicator } from './autofix';
export * from '@platformos/platformos-check-common';
// Where an app file can live, for an embedder that has to EXPLAIN the directory rule to
// an agent. Explaining is the only job out here — classifying is `lintBuffer`'s.
export { APP_SOURCE_SUBTREES } from '@platformos/platformos-common';
export * from './config/types';
export { NodeFileSystem };
export { runBackfillDocsCLI } from './backfill-docs';
export { resetRouteTable };
export { resetSharedApp };
/**
 * File identity, for an embedder running its OWN never-stale cache over the same project.
 *
 * The MCP supervisor's project-graph cache is the one such consumer: it fingerprints
 * every edge source to decide whether a cached graph still describes the tree. It shares
 * this definition rather than spelling its own because the definition is the part that
 * was hard to get right — `ctime` is in there because `mtime` is settable from userland,
 * so an mtime-restored same-length rewrite is invisible to `mtime:size`, and a second
 * implementation is a second chance to omit it and be stale in exactly that way.
 *
 * To be precise about what sharing does and does not buy: these caches never compare
 * fingerprints against EACH OTHER — each compares only against its own previous scan — so
 * two different definitions would not corrupt anything. What is shared is the measured
 * definition and the "could not tell" answer, not a comparison.
 */
export { fingerprintOf, isKnownFingerprint } from './fingerprints';
/**
 * Download the latest platformOS liquid docs over the local docset, then
 * {@link resetPlatformOSLiquidDocsManager} so the next lint run reads them.
 */
export async function updateDocs(log: (msg: string) => void = () => {}): Promise<void> {
  await downloadPlatformOSLiquidDocs(platformOSLiquidDocsRoot, log);
  resetPlatformOSLiquidDocsManager();
}

export const loadConfig: typeof resolveConfig = async (configPath, root) => {
  configPath ??= await findConfigPath(root);
  return resolveConfig(configPath, root);
};

export type AppCheckRun = {
  app: AppModel;
  config: Config;
  offenses: Offense[];
};

export async function toSourceCode(
  absolutePath: string,
): Promise<LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode | undefined> {
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    return commonToSourceCode(uriFromPath(absolutePath), source);
  } catch (e) {
    return undefined;
  }
}

export async function check(root: string, configPath?: string): Promise<Offense[]> {
  const run = await appCheckRun(root, configPath);
  return run.offenses;
}

export async function checkAndAutofix(root: string, configPath?: string) {
  const { app, offenses } = await appCheckRun(root, configPath);
  await autofix(app, offenses);
}

export async function appCheckRun(
  root: string,
  configPath?: string,
  log: (message: string) => void = () => {},
): Promise<AppCheckRun> {
  const { app, config } = await getAppAndConfig(root, configPath);
  const offenses = await lintApp(app, config, log);

  return {
    app,
    config,
    offenses,
  };
}

/**
 * Run the configured checks over an in-memory `App` and return the structured
 * `Offense[]` (with `fix` / `suggest` and all typed fields intact).
 *
 * Shared by {@link appCheckRun} (whole project on disk) and
 * {@link lintBuffer} (project on disk + one buffer overlaid). Serving
 * `getDocDefinition` from the passed `app` is what lets the overlaid buffer be
 * cross-referenced with its UNSAVED `{% doc %}` params rather than the stale
 * on-disk version.
 */
async function lintApp(
  app: AppModel,
  config: Config,
  log: (message: string) => void = () => {},
  only?: UriString[],
): Promise<Offense[]> {
  const platformOSLiquidDocsManager = getPlatformOSLiquidDocsManager();

  return withDocsManagerLog(log, () =>
    coreCheck(
      app,
      config,
      {
        fs: NodeFileSystem,
        platformosDocset: platformOSLiquidDocsManager,
        jsonValidationSet: platformOSLiquidDocsManager,
        // Lazy, and not limited to the app: see `doc-definitions.ts` for both.
        getDocDefinition: makeGetDocDefinition(app, NodeFileSystem, nodeParsers),
        // A provider, not a table: reconciling one costs a `stat` of every page, and only
        // `MissingPage` on a file that actually links somewhere needs it. The call lands
        // while `lintBuffer`'s overlay is still in place, which is what lets the buffer's
        // own frontmatter define its own route.
        routeTable: () => getSharedRouteTable(config.rootUri, app),
      },
      { only },
    ),
  );
}

/**
 * The docs manager this process is currently using.
 *
 * Every loader on `PlatformOSLiquidDocsManager` — including `setup()`, which makes a
 * NETWORK call to compare the local docs revision against the remote one — is a
 * per-instance memo, so one per lint run re-does that check and re-parses the docset
 * every time. Reusing one instance is what makes those memos pay off, and keeping the
 * SDL string stable is what lets check-common's schema cache hit.
 *
 * Reuse is time-boxed rather than permanent, because those memos also pin whatever each
 * resource resolved to on first use — including the bundled fallback a loader settles for
 * when the cache directory is missing (see `findSuitableResource`). That fallback is a
 * complete docset, so the cost is staleness, not breakage. Rebuilding after
 * {@link DOCS_MANAGER_MAX_AGE_MS} lets a long-lived process pick up a new remote revision
 * and the results of an out-of-band `--update-docs`.
 */
let sharedDocsManager: PlatformOSLiquidDocsManager | undefined;
let sharedDocsManagerBuiltAt = 0;

/**
 * How long one docs manager is reused before the next lint run builds a fresh one.
 * Long enough that the per-run cost this sharing exists to remove stays removed for
 * any realistic burst of calls; short enough that "docs updated" is a wait, not a
 * restart.
 */
const DOCS_MANAGER_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Forget the shared docs manager so the next lint run builds one from the docs
 * currently on disk. Called by {@link updateDocs}; exported for embedders that
 * refresh the docset by other means (and for tests).
 *
 * A docset changed by ANOTHER process (e.g. a separate `pos-cli` download) is
 * picked up without this call, but only on the first run after
 * {@link DOCS_MANAGER_MAX_AGE_MS}; calling this makes it immediate.
 */
export function resetPlatformOSLiquidDocsManager(): void {
  sharedDocsManager = undefined;
}

/**
 * The log sinks of the lint runs currently in flight, and the docset diagnostics
 * emitted so far.
 *
 * A shared manager outlives any one run, so it cannot capture that run's logger, and
 * routing to "the latest run" would deliver one run's diagnostics to another's output.
 * So it fans out to every run in flight.
 *
 * The REPLAY is what makes these messages usable: every loader is memoized, so a degraded
 * docset explains itself exactly once, during the process's first run — without replay
 * every later run sees unexplained `UnknownFilter` offenses against an empty log. The
 * history is bounded because each writer sits behind a per-instance memo.
 */
const activeDocsManagerLogs = new Set<(message: string) => void>();
const docsManagerLogHistory: string[] = [];

function getPlatformOSLiquidDocsManager(): PlatformOSLiquidDocsManager {
  if (Date.now() - sharedDocsManagerBuiltAt > DOCS_MANAGER_MAX_AGE_MS) {
    sharedDocsManager = undefined;
  }

  if (!sharedDocsManager) {
    // A rebuilt manager re-reports whatever it finds, so start the history over
    // rather than replaying the previous instance's (now answered) complaints.
    docsManagerLogHistory.length = 0;
    sharedDocsManagerBuiltAt = Date.now();
    sharedDocsManager = new PlatformOSLiquidDocsManager((message) => {
      docsManagerLogHistory.push(message);
      for (const sink of activeDocsManagerLogs) sink(message);
    });
  }

  return sharedDocsManager;
}

/**
 * Run `lint` with `log` subscribed to the shared docset's diagnostics: first the
 * ones it has already emitted, then any it emits while this run is in flight.
 */
async function withDocsManagerLog<T>(
  log: (message: string) => void,
  lint: () => Promise<T>,
): Promise<T> {
  for (const message of docsManagerLogHistory) log(message);
  activeDocsManagerLogs.add(log);
  try {
    return await lint();
  } finally {
    activeDocsManagerLogs.delete(log);
  }
}

export interface LintBufferParams {
  /** Absolute path to the project root. */
  root: string;
  /** Absolute path to the file under edit. */
  filePath: string;
  /** In-memory contents of the file under edit (may differ from, or not yet exist on, disk). */
  content: string;
  /** Explicit config path; resolved from `root` when omitted. */
  configPath?: string;
  log?: (message: string) => void;
}

/**
 * What {@link lintBuffer} did with the file it was given.
 *
 * `checked` is the only status whose empty `offenses` means "no problems found". The
 * others mean the file was not looked at, and each has a different remedy, which is why
 * they are not one `skipped` flag.
 *
 * The two out-of-app statuses are split HERE, where the classification happens, so an
 * embedder never re-classifies a raw filesystem path to draw the distinction.
 */
export type LintBufferStatus =
  /** The checks ran. `offenses` is the complete answer for this buffer. */
  | 'checked'
  /** The project's `.platformos-check.yml` `ignore` list covers this path. */
  | 'excluded-by-config'
  /**
   * A platformOS SOURCE — something this toolchain parses — outside every subtree
   * the platform deploys. Almost always a mistake: the platform will never load
   * the file, so a partial, page or query here is dead code.
   */
  | 'misplaced-source'
  /**
   * Not a platformOS source at all: not in a deployed subtree, and nothing here
   * parses it. Routine — a project holds plenty of files that are not platformOS
   * sources and are not meant to be, so this must not be advised "move it under
   * app/".
   */
  | 'not-a-platformos-file'
  /** An app file the toolchain has no parser or checks for — an asset (`.js`, `.css`, an image). */
  | 'not-a-source-file';

export interface LintBufferResult {
  status: LintBufferStatus;
  /** The buffer file's offenses. Always empty unless `status` is `checked`. */
  offenses: Offense[];
}

/**
 * Lint a single in-memory buffer in the context of its on-disk project.
 *
 * This is the typed seam the MCP supervisor lints through — NOT an LSP, NOT a
 * subprocess. The on-disk project is loaded so cross-file checks
 * (`MissingPartial`, `MissingPage`, `TranslationKeyExists`, …) resolve against real
 * files, and the buffer under edit is overlaid in memory so the UNSAVED content
 * is what gets linted and cross-referenced. Returns the structured
 * check-common `Offense[]` for the buffer's file, with `fix` / `suggest` and all
 * typed fields preserved end to end (no message-string round-trip).
 *
 * **It also says whether it checked the file at all**, via {@link LintBufferStatus}.
 * Four kinds of path are never linted, and an empty `Offense[]` for any of them is
 * indistinguishable from a clean file — the wrong answer to "is this file OK before I
 * write it?".
 *
 * `filePath` must be absolute. When it already exists in the project its on-disk
 * `SourceCode` is replaced by the buffer; when it is new the buffer is added so it is
 * still linted.
 *
 * Only the buffer's file is VISITED (`CheckOptions.only`), while the complete project is
 * still handed to `check()` so cross-file checks resolve against it. That is a pure
 * speed-up, not a narrowing: offenses are always attributed to the visited file, so
 * visiting the others could only produce results this function discards.
 */
export async function lintBuffer(params: LintBufferParams): Promise<LintBufferResult> {
  const { filePath, ...rest } = params;
  const results = await lintBuffers({ ...rest, buffers: [{ filePath, content: params.content }] });
  // One buffer in, so one result out — and `lintBuffers` keys by the same
  // `uriFromPath(filePath)` this would compute, so the lookup cannot miss.
  return results.get(uriFromPath(filePath))!;
}

/** One in-memory buffer in a {@link lintBuffers} batch. */
export interface BufferToLint {
  /** Absolute path to the file under edit. */
  filePath: string;
  /** In-memory contents (may differ from, or not yet exist on, disk). */
  content: string;
}

export interface LintBuffersParams extends Omit<LintBufferParams, 'filePath' | 'content'> {
  /**
   * The buffers under edit. A later entry for the same path wins, matching "last write
   * for this file", so a caller need not deduplicate. Two entries for one file would
   * otherwise overlay twice and double every offense for it.
   */
  buffers: BufferToLint[];
}

/**
 * Lint SEVERAL in-memory buffers in ONE pass over the project, keyed by normalized URI.
 *
 * WHY THIS IS THE PRIMARY SEAM, with {@link lintBuffer} delegating to it. Everything
 * expensive is per-PROJECT, not per-buffer: resolving the config, walking and reconciling
 * the shared `App`, reconciling the route table. Linting N buffers one call at a time
 * repeats all of it N times against an unchanged project.
 *
 * IT IS ALSO MORE CORRECT, which matters more than the speed. With every buffer overlaid
 * at once, a partial introduced in one buffer resolves for a `render` in another. Linting
 * the same edit file-by-file reports `MissingPartial` for a file that exists in the very
 * batch being checked — a false positive inherent to the single-buffer shape, not a
 * tuning problem.
 *
 * Every buffer gets its OWN {@link LintBufferResult}, so a batch mixing an asset, an
 * ignored path and two real sources answers each on its own terms. One vocabulary for
 * both seams: a caller never has to learn a second way of being told "not checked".
 *
 * Only the buffers are VISITED (`CheckOptions.only`) while the whole project stays
 * visible to cross-file checks. Offenses are always attributed to the visited file, so
 * visiting the rest could only produce results this function discards.
 */
export async function lintBuffers(
  params: LintBuffersParams,
): Promise<Map<UriString, LintBufferResult>> {
  const { root, buffers, configPath, log = () => {} } = params;
  const results = new Map<UriString, LintBufferResult>();
  if (buffers.length === 0) return results;

  const config = await loadConfig(configPath, root);

  // Last entry for a path wins.
  const requested = new Map<UriString, string>();
  for (const buffer of buffers) requested.set(uriFromPath(buffer.filePath), buffer.content);

  // Asked before the app is walked: no amount of project context changes the answer.
  // `isIgnored` canonicalizes its subject, so these URIs and the ones `check()` asks
  // about get the same answer despite arriving in different spellings.
  const toOverlay = new Map<UriString, string>();
  for (const [uri, content] of requested) {
    if (isIgnored(uri, config)) results.set(uri, notChecked('excluded-by-config'));
    else toOverlay.set(uri, content);
  }
  // A batch of nothing but ignored paths must not pay for the walk, exactly as the
  // single-buffer seam does not.
  if (toOverlay.size === 0) return results;

  const app = await getApp(config);
  /** Undo one overlay. Collected as we go so a throw still reverts what was applied. */
  const restore: Array<() => void> = [];
  const visit: UriString[] = [];

  try {
    for (const [uri, content] of toOverlay) {
      // The buffer's source replaces whatever was on disk (adding the file when it is
      // not saved yet), and the version marks it as a buffer so translation lookups and
      // any other "prefer unsaved content" path pick it up.
      const onDisk = app.has(uri);
      const file = app.setSource(uri, content, BUFFER_VERSION);
      // `undefined` means the path is in no platformOS directory, so there is nothing to
      // add and nothing to undo. Same URI, same classifier, so the miss needs no second
      // opinion.
      if (!file) {
        results.set(
          uri,
          notChecked(
            sourceCodeTypeOf(uri) === undefined ? 'not-a-platformos-file' : 'misplaced-source',
          ),
        );
        continue;
      }
      // Registered BEFORE the type check below: an asset was still overlaid, so it still
      // has to be reverted.
      restore.push(() => (onDisk ? app.invalidate(uri) : app.remove([uri])));

      // Classified, but nothing parses it: `check()` iterates the source types, so an
      // asset is never visited however many checks are enabled.
      if (file.type === undefined) {
        results.set(uri, notChecked('not-a-source-file'));
        continue;
      }

      // Seeded so a clean buffer reports `checked` with no offenses, which is the whole
      // point of the status: an empty list must not be indistinguishable from unchecked.
      results.set(uri, { status: 'checked', offenses: [] });
      visit.push(uri);
    }

    if (visit.length > 0) {
      for (const offense of await lintApp(app, config, log, visit)) {
        // `only` already restricts the visit to these files; the lookup keeps the
        // partition explicit and independent of that optimization.
        results.get(offense.uri)?.offenses.push(offense);
      }
    }

    // Reported in REQUEST order. `results` was filled in two passes (ignored first, then
    // overlaid), and that is an implementation detail a caller iterating the map should
    // not see. Total by construction: every requested URI is either ignored or overlaid,
    // and both paths set an entry.
    return new Map([...requested.keys()].map((uri) => [uri, results.get(uri)!]));
  } finally {
    // The app outlives this call, so the overlay must not: one request's unsaved content
    // is not the next request's truth.
    for (const undo of restore) undo();
  }
}

function notChecked(status: LintBufferStatus): LintBufferResult {
  return { status, offenses: [] };
}

/**
 * The version stamped on the buffer `lintBuffer` overlays. `undefined` means "the contents
 * on disk" throughout the toolchain, so a buffer must carry a number for the code that
 * prefers unsaved content to see it. The value itself is not meaningful.
 */
const BUFFER_VERSION = 0;

export async function getAppAndConfig(
  root: string,
  configPath?: string,
): Promise<{ app: AppModel; config: Config }> {
  const config = await loadConfig(configPath, root);
  const app = await getApp(config);
  return {
    app,
    config,
  };
}

/**
 * The parsers the {@link AppModel} in this runtime parses with — check-common's
 * `sourceParsers`, not a copy: the language server builds `App`s too, and a second
 * spelling of "how a `.liquid` file becomes an AST" is a second thing to keep in step.
 * The alias stays because embedders import it by name.
 */
export const nodeParsers: Parsers = sourceParsers;

/**
 * The app for `config`: walk the project, reconcile the process's {@link AppModel}
 * with what the walk found, and read NOTHING.
 *
 * The files are {@link AppModel} files, so each reads its source on the first `load()`
 * and parses on the first `ast`: a `validate_code` call visits one file and lazily
 * reaches a handful more through `{% render %}` / `{% doc %}` resolution.
 *
 * The app itself is shared per process and reconciled per call rather than rebuilt (see
 * `shared-app.ts`). What the WALK finds is never cached, so a file added, edited or
 * deleted between two calls is reflected in the next one.
 *
 * A parse error is surfaced as a captured `Error` on that file's `ast`, produced when the
 * file is first read, so an unparseable file nobody visits costs nothing.
 */
export async function getApp(config: Config): Promise<AppModel> {
  const paths = await getAppFilePaths(config);
  return getSharedApp(config.rootUri, paths, nodeParsers);
}

/**
 * Every path in the project that COULD be a platformOS source, as a URI.
 *
 * Candidates, not app files. Which of them the app contains is `parseAppPath`'s answer and
 * `App.fromPaths` asks it — this function deliberately knows nothing about the platformOS
 * directory structure, because a second opinion can only ever disagree with the first.
 *
 * The user's `ignore` is deliberately NOT applied: an ignored file is an ordinary part of
 * the app, and `ignore` only silences the offenses REPORTED on it, which is `check()`'s
 * job. See `index.spec.ts`.
 *
 * Path work only — no `stat`, no read. The walk is {@link walkAppSourceFiles}, the same
 * one the graph build and the language server's preload use, anchored on
 * `APP_SOURCE_SUBTREES` so it never enumerates the rest of the repository.
 */
async function getAppFilePaths(config: Config): Promise<UriString[]> {
  return walkAppSourceFiles(NodeFileSystem, config.rootUri, ([uri]) =>
    SOURCE_FILE_EXTENSIONS.some((extension) => uri.endsWith(extension)),
  );
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
