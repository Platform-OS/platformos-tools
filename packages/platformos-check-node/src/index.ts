import {
  Config,
  DocDefinition,
  GraphQLSourceCode,
  JSONSourceCode,
  LiquidSourceCode,
  Offense,
  App,
  appFiles,
  toSourceCode as commonToSourceCode,
  check as coreCheck,
  extractDocDefinition,
  filePathSupportsLiquidDoc,
  isIgnored,
  memo,
  path as pathUtils,
  sourceParsers,
  UriString,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';
import {
  App as AppModel,
  APP_SOURCE_SUBTREES,
  Parsers,
  SOURCE_FILE_EXTENSIONS,
  SOURCE_FILE_GLOB,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import {
  PlatformOSLiquidDocsManager,
  downloadPlatformOSLiquidDocs,
  root as platformOSLiquidDocsRoot,
} from '@platformos/platformos-check-docs-updater';
import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';
import normalize from 'normalize-path';

import { autofix } from './autofix';
import { findConfigPath, loadConfig as resolveConfig } from './config';
import { NodeFileSystem } from './NodeFileSystem';
import { getSharedRouteTable, resetRouteTable, warmRouteTable } from './route-table';
import { getSharedApp, resetSharedApp } from './shared-app';
import { fileURLToPath } from 'node:url';

export * from '@platformos/platformos-check-common';
// Where an app file can live, and which extensions this toolchain parses, for an
// embedder that has to EXPLAIN a path it cannot lint. Re-exported rather than
// respelled: both facts have one home.
export { APP_SOURCE_SUBTREES, sourceCodeTypeOf } from '@platformos/platformos-common';
export * from './config/types';
export { NodeFileSystem };
export { runBackfillDocsCLI } from './backfill-docs';
export { resetRouteTable, warmRouteTable };
export { resetSharedApp };
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
  app: App;
  config: Config;
  offenses: Offense[];
};

export async function toSourceCode(
  absolutePath: string,
): Promise<LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode | undefined> {
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    return commonToSourceCode(pathUtils.normalize(URI.file(absolutePath)), source);
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
  const offenses = await lintApp(root, app, config, log);

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
 * {@link lintBuffer} (project on disk + one buffer overlaid). Building the
 * `getDocDefinition` map from the passed `app` is what lets the overlaid buffer
 * be cross-referenced with its UNSAVED `{% doc %}` params rather than the
 * stale on-disk version.
 */
async function lintApp(
  root: string,
  app: AppModel,
  config: Config,
  log: (message: string) => void = () => {},
  only?: UriString[],
): Promise<Offense[]> {
  const platformOSLiquidDocsManager = getPlatformOSLiquidDocsManager();
  const rootUri = URI.file(root).toString();

  // One memo per file, built without touching any of them: the `load()` is INSIDE
  // the memo body, so a file only gets read and parsed if some check actually
  // resolves a `{% render %}` / `{% function %}` to it. Awaiting the load at map
  // time instead would load the whole project and undo the point of the model.
  const docDefinitions = new Map(
    appFiles(app).map((file) => [
      path.relative(rootUri, file.uri),
      memo(async (): Promise<DocDefinition | undefined> => {
        if (!filePathSupportsLiquidDoc(file.uri, rootUri)) {
          return undefined;
        }
        await file.load?.();
        const ast = file.ast;
        if (!isLiquidHtmlNode(ast)) {
          return undefined;
        }
        return extractDocDefinition(file.uri, ast);
      }),
    ]),
  );

  return withDocsManagerLog(log, () =>
    coreCheck(
      app,
      config,
      {
        fs: NodeFileSystem,
        platformosDocset: platformOSLiquidDocsManager,
        jsonValidationSet: platformOSLiquidDocsManager,
        getDocDefinition: async (relativePath) => docDefinitions.get(relativePath)?.(),
        // A provider, not a table: reconciling one costs a `stat` of every page in the
        // project, and only `MissingPage` on a file that actually links somewhere needs
        // it. `check` calls this at most once per run, and only if a check asks — so a
        // run over Liquid with no `<a href>`/`<form action>` touches no page at all.
        // The call lands while `lintBuffer`'s overlay is still in place, which is what
        // lets the buffer's own frontmatter define its own route.
        routeTable: () => getSharedRouteTable(config.rootUri, app),
      },
      { only },
    ),
  );
}

/**
 * The docs manager this process is currently using.
 *
 * Every loader on `PlatformOSLiquidDocsManager` — including `setup()`, which makes
 * a NETWORK call to compare the local docs revision against the remote one — is a
 * per-instance memo. Constructing one per lint run therefore re-did that network
 * check, and re-read and re-parsed filters/objects/tags/SDL from disk, on every
 * single run: ~200 ms per `validate_code` call for a long-lived server. Reusing one
 * instance is what makes those memos pay off, and keeping the SDL string stable is
 * also what lets check-common's schema cache hit.
 *
 * Reuse is time-boxed rather than permanent, because those memos also pin whatever
 * each resource resolved to on first use — including the bundled fallback a loader
 * settles for when the cache directory is missing or a resource file is unreadable
 * (see `findSuitableResource`). The fallback is a complete docset, so the cost is
 * staleness rather than breakage: a process that started before its docs were
 * downloaded keeps linting against the bundled snapshot. Rebuilding on the first
 * run after {@link DOCS_MANAGER_MAX_AGE_MS} keeps a burst of `validate_code` calls
 * on one instance while letting a long-lived process pick up a new remote revision
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
 * A shared manager cannot capture one run's logger: it outlives that run. It
 * cannot route to "the latest run" either — that delivers one run's diagnostics
 * to another run's output, or to a run that has already returned. So it fans out
 * to every run in flight, and each run is replayed the diagnostics the docset
 * already emitted before it started.
 *
 * The replay is what makes these messages usable at all. Every loader is
 * memoized, so a degraded docset explains itself exactly once — during the first
 * run of the process. Without replay, that explanation is discarded and every later
 * run sees unexplained `UnknownFilter` offenses against an empty log. The history
 * is bounded by the manager itself: every call site that writes to `log` sits behind
 * a per-instance memo, so one instance emits a small fixed set of messages.
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
 * `checked` is the only status whose empty `offenses` means "no problems found".
 * The other three mean the file was not looked at, and each has a different
 * remedy, which is why they are not one `skipped` flag.
 */
export type LintBufferStatus =
  /** The checks ran. `offenses` is the complete answer for this buffer. */
  | 'checked'
  /** The project's `.platformos-check.yml` `ignore` list covers this path. */
  | 'excluded-by-config'
  /** The path is not under `app/`, `marketplace_builder/` or `modules/<name>/(public|private)/`, so it is not part of the app. */
  | 'not-an-app-file'
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
 * **It also says whether it checked the file at all.** Three kinds of path are
 * never linted — one the config excludes, one outside the app's subtrees, one
 * that is an asset rather than a source — and each used to come back as an empty
 * `Offense[]`, which is exactly what a clean file returns. For `pos-cli check`
 * that is harmless; for a caller that asked "is this file OK before I write it?"
 * it is the wrong answer given confidently. {@link LintBufferStatus} is that
 * distinction, and `offenses` is empty for all three.
 *
 * `filePath` must be absolute. When it already exists in the project its
 * on-disk `SourceCode` is replaced by the buffer; when it is new (not yet
 * saved) the buffer is added so it is still linted.
 *
 * Only the buffer's file is VISITED (`CheckOptions.only`), while the complete
 * project is still handed to `check()` so cross-file checks resolve against it.
 * That is a pure speed-up, not a narrowing: offenses are always attributed to the
 * visited file, so visiting the others could only ever produce results this
 * function discards. On a 1400-file project it takes the check phase from ~21 s to
 * ~0.15 s — after which `getAppAndConfig` below, which reads and eagerly parses
 * every file in the project on every call, is what dominates the latency a caller
 * actually sees.
 */
export async function lintBuffer(params: LintBufferParams): Promise<LintBufferResult> {
  const { root, filePath, content, configPath, log = () => {} } = params;
  const config = await loadConfig(configPath, root);
  const uri = pathUtils.normalize(URI.file(filePath));

  // Asked before the app is even walked, because a file the config excludes is one
  // no amount of project context would change the answer for. Both shapes are
  // tested: `getApp` matches the `ignore` patterns against the filesystem path and
  // `check()` against the URI, and a file either one excludes is a file no check
  // will visit.
  if (isIgnored(uri, config) || isIgnored(normalize(fileURLToPath(uri)), config)) {
    return notChecked('excluded-by-config');
  }

  const app = await getApp(config);
  // Overlaying is a mutation of the one file rather than a rebuilt array: the
  // buffer's source replaces whatever was on disk (adding the file when it is not
  // saved yet), and the version marks it as a buffer so translation lookups and
  // any other "prefer unsaved content" path pick it up.
  const onDisk = app.has(uri);
  const file = app.setSource(uri, content, BUFFER_VERSION);
  // `undefined` means the path is in no platformOS directory, so the model has
  // nothing to add and there is nothing to undo either.
  if (!file) return notChecked('not-an-app-file');

  try {
    // Classified, but nothing parses it: `check()` iterates the source types, so an
    // asset is never visited however many checks are enabled.
    if (file.type === undefined) return notChecked('not-a-source-file');

    return { status: 'checked', offenses: await lintApp(root, app, config, log, [uri]) };
  } finally {
    // The app outlives this call, so the overlay must not: unsaved content is true
    // for the duration of the request that supplied it and nothing longer. A file
    // that exists goes back to reading from disk; one that does not exist yet
    // leaves the app entirely, as it would never have been in it.
    if (onDisk) app.invalidate(uri);
    else app.remove([uri]);
  }
}

function notChecked(status: LintBufferStatus): LintBufferResult {
  return { status, offenses: [] };
}

/**
 * The version stamped on the buffer `lintBuffer` overlays.
 *
 * `undefined` means "these are the contents on disk" throughout the toolchain, so
 * an in-memory buffer must carry a number for the code that prefers unsaved
 * content over the filesystem to see it. The value itself is not meaningful —
 * nothing here syncs versions with a client.
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
 * The parsers the {@link AppModel} in this runtime parses with.
 *
 * The mapping itself is check-common's `sourceParsers`, not a copy of it: the
 * language server builds `App`s too, and a second spelling of "how a `.liquid`
 * file becomes an AST" is a second thing to keep in step. The alias stays because
 * embedders import it by name.
 */
export const nodeParsers: Parsers = sourceParsers;

/**
 * The app for `config`: walk the project, reconcile the process's {@link AppModel}
 * with what the walk found, and read NOTHING.
 *
 * The files are {@link AppModel} files, so each one reads its source on the first
 * `load()` and parses on the first `ast`. A `validate_code` call visits one file
 * and lazily reaches ~9 more through `{% render %}` / `{% doc %}` resolution, so
 * on a 1400-file project this parses about 0.7% of it. Before the model this
 * function read and parsed all 1400 on every call — 3.6-5.8 s of work whose
 * results were discarded, and the source of the 400-650 MB RSS peaks, since the
 * ASTs became garbage immediately.
 *
 * The app itself is shared per process and reconciled per call rather than rebuilt
 * (see `shared-app.ts`), because building it was what a warm call still spent most
 * of its time on once the walk was pruned. What the walk finds is never cached: a
 * file added, edited or deleted between two calls is reflected in the next one.
 *
 * A parse error is still surfaced as a captured `Error` on that file's `ast` — now
 * produced when the file is first read rather than up front, which is why an
 * unparseable file nobody visits no longer costs anything at all.
 */
export async function getApp(config: Config): Promise<AppModel> {
  const paths = await getAppFilePaths(config);
  return getSharedApp(config.rootUri, paths, nodeParsers);
}

/**
 * Every path in the project that COULD be a platformOS source, as a URI.
 *
 * Candidates, not app files. Which of them the app actually contains is
 * `parseAppPath`'s answer and `App.fromPaths` asks it — this function deliberately
 * knows nothing about the platformOS directory structure, because a second opinion
 * about what `app/lib/smses/x.liquid` is can only ever disagree with the first.
 * The one filter left is LOCAL knowledge: the user's configured `ignore`.
 *
 * Path work only — no `stat`, no read — but the WALK is the cost, and walking the
 * whole repository to then discard most of it is what made it expensive: `getApp`
 * took 345 ms on arabbank and 1371 ms on Accala-MP, nearly all of it in
 * `node_modules` trees that contribute zero files to the app.
 *
 * The walk is {@link walkAppSourceFiles}, the same one the graph build and the
 * language server's preload use — a `readdir` recursion over `APP_SOURCE_SUBTREES`
 * rather than a `glob` of the equivalent patterns. Same paths, file for file, on
 * arabbank, Accala-MP and pos-module-community; 10-25% faster, because a walk
 * filters by extension as it enumerates instead of matching a pattern per path.
 */
async function getAppFilePaths(config: Config): Promise<UriString[]> {
  const uris = await walkAppSourceFiles(NodeFileSystem, config.rootUri, ([uri]) =>
    SOURCE_FILE_EXTENSIONS.some((extension) => uri.endsWith(extension)),
  );

  return uris.filter(
    // Global ignored paths should not be part of the app. The patterns are matched
    // against the FILESYSTEM path, forward-slashed for Windows, which is the shape
    // `isIgnored` has always been given here.
    (uri) => !isIgnored(normalize(fileURLToPath(uri)), config),
  );
}

// `getAppFilesPathPatterns` was here, kept "for consumers that need PATTERNS rather
// than a walk, i.e. file watchers". It had none: not pos-cli, which uses only
// `allChecks`, `appCheckRun`, `autofix`, `loadConfig` and `updateDocs`, and not the
// language server, whose watcher builds its own globs from `SOURCE_FILE_GLOB`. Its
// only caller was its own spec. A watcher that wants the patterns should build them
// from `APP_SOURCE_SUBTREES` and `SOURCE_FILE_GLOB` in `platformos-common`, which is
// all this did.

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
