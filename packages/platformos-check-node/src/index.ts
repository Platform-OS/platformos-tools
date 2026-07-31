import {
  Config,
  DocDefinition,
  GraphQLSourceCode,
  JSONSourceCode,
  LiquidSourceCode,
  Offense,
  App,
  toSourceCode as commonToSourceCode,
  check as coreCheck,
  extractDocDefinition,
  filePathSupportsLiquidDoc,
  isIgnored,
  isKnownLiquidFile,
  isKnownGraphQLFile,
  isKnownYAMLFile,
  memo,
  path as pathUtils,
  UriString,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';
import {
  PlatformOSLiquidDocsManager,
  downloadPlatformOSLiquidDocs,
  root as platformOSLiquidDocsRoot,
} from '@platformos/platformos-check-docs-updater';
import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';
import { glob } from 'glob';
import normalize from 'normalize-path';

import { autofix } from './autofix';
import { findConfigPath, loadConfig as resolveConfig } from './config';
import { NodeFileSystem } from './NodeFileSystem';
import { fileURLToPath } from 'node:url';

export * from '@platformos/platformos-check-common';
export * from './config/types';
export { NodeFileSystem };
export { runBackfillDocsCLI } from './backfill-docs';
export async function updateDocs(log: (msg: string) => void = () => {}): Promise<void> {
  await downloadPlatformOSLiquidDocs(platformOSLiquidDocsRoot, log);
  // The shared manager has memoized the docs we just replaced. Without this, a
  // process that updates its docs keeps linting against the pre-update docset.
  invalidateDocsManager();
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
  app: App,
  config: Config,
  log: (message: string) => void = () => {},
  only?: UriString[],
): Promise<Offense[]> {
  const platformOSLiquidDocsManager = getPlatformOSLiquidDocsManager();

  const docDefinitions = new Map(
    app.map((file) => [
      path.relative(URI.file(root).toString(), file.uri),
      memo(async (): Promise<DocDefinition | undefined> => {
        const ast = file.ast;
        if (!isLiquidHtmlNode(ast)) {
          return undefined;
        }
        if (!filePathSupportsLiquidDoc(file.uri)) {
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
 * Reuse is time-boxed rather than permanent. Because the memos are per instance,
 * an instance kept forever also pins forever whatever docset its FIRST run
 * resolved — including the bundled fallback it settles for when `setup()` fails
 * (no network, docs not downloaded yet, a half-written resource file). A server
 * that started offline would then report `UnknownFilter` on valid code for its
 * whole life, and nothing short of a restart would fix it. Rebuilding on the
 * first run after {@link DOCS_MANAGER_MAX_AGE_MS} keeps a burst of `validate_code`
 * calls on one instance while letting a long-lived process recover, pick up a new
 * remote revision, and see the results of an out-of-band `--update-docs`.
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
 * Drop the shared docs manager so the next lint run builds one from the docs
 * currently on disk. {@link updateDocs} calls this; hosts that refresh the docs
 * cache by other means can call it too.
 */
export function invalidateDocsManager(): void {
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
 * run of the process, which for the MCP supervisor is a `lintBuffer` call with no
 * `log` at all. Without replay, that explanation is discarded and every later run
 * sees hundreds of unexplained `UnknownFilter` offenses against an empty log.
 */
const activeDocsManagerLogs = new Set<(message: string) => void>();
const docsManagerLogHistory: string[] = [];

/** Enough to carry a full set of loader failures; a cap so a long-lived process cannot grow it. */
const DOCS_MANAGER_LOG_HISTORY_LIMIT = 50;

function getPlatformOSLiquidDocsManager(): PlatformOSLiquidDocsManager {
  const expired = Date.now() - sharedDocsManagerBuiltAt > DOCS_MANAGER_MAX_AGE_MS;
  if (sharedDocsManager && expired) invalidateDocsManager();

  if (!sharedDocsManager) {
    // A rebuilt manager re-reports whatever it finds, so start the history over
    // rather than replaying the previous instance's (now answered) complaints.
    docsManagerLogHistory.length = 0;
    sharedDocsManagerBuiltAt = Date.now();
    sharedDocsManager = new PlatformOSLiquidDocsManager((message) => {
      docsManagerLogHistory.push(message);
      if (docsManagerLogHistory.length > DOCS_MANAGER_LOG_HISTORY_LIMIT) {
        docsManagerLogHistory.shift();
      }
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
 * Lint a single in-memory buffer in the context of its on-disk project.
 *
 * This is the typed seam the MCP supervisor lints through — NOT an LSP, NOT a
 * subprocess. The on-disk project is loaded so cross-file checks
 * (`MissingPartial`, `MissingPage`, `OrphanedPartial`, …) resolve against real
 * files, and the buffer under edit is overlaid in memory so the UNSAVED content
 * is what gets linted and cross-referenced. Returns the structured
 * check-common `Offense[]` for the buffer's file, with `fix` / `suggest` and all
 * typed fields preserved end to end (no message-string round-trip).
 *
 * `filePath` must be absolute. When it already exists in the project its
 * on-disk `SourceCode` is replaced by the buffer; when it is new (not yet
 * saved) the buffer is added so it is still linted.
 *
 * Only the buffer's file is VISITED (`CheckOptions.only`), while the complete
 * project is still handed to `check()` so cross-file checks resolve against it.
 * That is a pure speed-up, not a narrowing: offenses are always attributed to the
 * visited file, so visiting the others could only ever produce results this
 * function discards. On a 1400-file project it is the difference between ~21 s
 * and ~0.1 s of check time.
 */
export async function lintBuffer(params: LintBufferParams): Promise<Offense[]> {
  const { root, filePath, content, configPath, log = () => {} } = params;
  const { app, config } = await getAppAndConfig(root, configPath);
  const uri = pathUtils.normalize(URI.file(filePath));
  const overlaidApp = overlayBuffer(app, uri, content);
  const offenses = await lintApp(root, overlaidApp, config, log, [uri]);
  // Belt and braces: `only` already restricts this to the buffer's file, but the
  // filter keeps the contract explicit and independent of that optimization.
  return offenses.filter((offense) => offense.uri === uri);
}

/**
 * Return a copy of `app` with the `SourceCode` for `uri` replaced by one built
 * from `content`, appending it when the file is not already present.
 */
function overlayBuffer(app: App, uri: string, content: string): App {
  const overlay = commonToSourceCode(uri, content);
  let replaced = false;
  const next = app.map((file) => {
    if (file.uri !== uri) return file;
    replaced = true;
    return overlay;
  });
  if (!replaced) next.push(overlay);
  return next;
}

export async function getAppAndConfig(
  root: string,
  configPath?: string,
): Promise<{ app: App; config: Config }> {
  const config = await loadConfig(configPath, root);
  const app = await getApp(config);
  return {
    app,
    config,
  };
}

export async function getApp(config: Config): Promise<App> {
  // On windows machines - the separator provided by path.join is '\'
  // however the glob function fails silently since '\' is used to escape glob charater
  // as mentioned in the documentation of node-glob

  // the path is normalised and '\' are replaced with '/' and then passed to the glob function
  let normalizedGlob = getAppFilesPathPattern(config.rootUri);

  const paths = await glob(normalizedGlob, { absolute: true }).then((result) =>
    result
      // Normalize backslashes to forward slashes so that isKnownLiquidFile() and
      // isIgnored() regex/minimatch patterns (which use forward slashes) work on Windows.
      .map(normalize)
      .filter((filePath) => {
        // Global ignored paths should not be part of the app
        if (isIgnored(filePath, config)) return false;
        // Only lint .liquid files that belong to a recognized platformOS directory.
        // Generator templates, build artifacts, etc. are excluded.
        if (filePath.endsWith('.liquid') && !isKnownLiquidFile(filePath)) return false;
        // Only lint .graphql files that belong to a recognized platformOS GraphQL directory.
        // Schema files, generator templates (e.g. ERB .graphql), etc. are excluded.
        if (filePath.endsWith('.graphql') && !isKnownGraphQLFile(filePath)) return false;
        // Only lint .yml/.yaml files that belong to a recognized platformOS YAML
        // directory (translations, custom model types, etc.). Config files like
        // config.yml or .platformos-check.yml are excluded.
        if (
          (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) &&
          !isKnownYAMLFile(filePath)
        ) {
          return false;
        }
        return true;
      }),
  );
  const sourceCodes = await Promise.all(paths.map(toSourceCode));
  return sourceCodes.filter(
    (x): x is LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode =>
      x !== undefined,
  );
}

export function getAppFilesPathPattern(rootUri: string) {
  return normalize(path.join(fileURLToPath(rootUri), '**/*.{liquid,graphql,yml,yaml}'));
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
