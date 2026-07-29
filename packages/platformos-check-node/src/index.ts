import {
  Config,
  DocDefinition,
  GraphQLSourceCode,
  JSONSourceCode,
  JSONValidator,
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
/**
 * Download the latest platformOS liquid docs over the local docset.
 *
 * Also drops this process's shared docs manager (see
 * {@link getPlatformOSLiquidDocsManager}). That manager memoizes every resource
 * for its lifetime, so without the reset a process that refreshed the docs and
 * then linted would keep validating against the docset it read BEFORE the
 * download — reporting a brand-new filter as `UnknownFilter`, or a new GraphQL
 * field as unknown, with the fix already sitting on disk.
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
  app: App,
  config: Config,
  log: (message: string) => void = () => {},
  only?: UriString[],
): Promise<Offense[]> {
  const platformOSLiquidDocsManager = getPlatformOSLiquidDocsManager(log);

  const validator = await JSONValidator.create(platformOSLiquidDocsManager, config);

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

  return coreCheck(
    app,
    config,
    {
      fs: NodeFileSystem,
      platformosDocset: platformOSLiquidDocsManager,
      jsonValidationSet: platformOSLiquidDocsManager,
      getDocDefinition: async (relativePath) => docDefinitions.get(relativePath)?.(),
    },
    { only },
  );
}

/**
 * The one docs manager this process uses, and the log sink it currently reports
 * through.
 *
 * Every loader on `PlatformOSLiquidDocsManager` — including `setup()`, which makes
 * a NETWORK call to compare the local docs revision against the remote one — is a
 * per-instance memo. Constructing one per lint run therefore re-did that network
 * check, and re-read and re-parsed filters/objects/tags/SDL from disk, on every
 * single run: ~200 ms per `validate_code` call for a long-lived server. The docset
 * is a process-level constant (it does not vary by project or by call), so one
 * instance is correct and the memos finally pay off. Keeping the SDL string stable
 * is also what lets check-common's schema cache hit.
 *
 * The sink is swapped per run rather than captured once, so each run's docset
 * diagnostics reach ITS logger instead of being silently delivered to whichever
 * run happened to be first. Runs are expected to be sequential; if two ever
 * overlap, a late async docset message can land in the newer run's log — a
 * cosmetic mislabelling of a diagnostic line, never a lint result.
 */
let sharedDocsManager: PlatformOSLiquidDocsManager | undefined;
let sharedDocsManagerLog: (message: string) => void = () => {};

function getPlatformOSLiquidDocsManager(
  log: (message: string) => void,
): PlatformOSLiquidDocsManager {
  sharedDocsManagerLog = log;
  sharedDocsManager ??= new PlatformOSLiquidDocsManager((message) => sharedDocsManagerLog(message));
  return sharedDocsManager;
}

/**
 * Forget the shared docs manager so the next lint run reads the docset afresh.
 *
 * The manager's loaders are per-instance memos with no way to clear them, so
 * discarding the instance is the only way to pick up docs that changed underneath
 * a long-lived process. Called by {@link updateDocs}; exported for embedders that
 * refresh the docset by other means (and for tests).
 *
 * NOTE: this does not help a docset changed by ANOTHER process (e.g. a separate
 * `pos-cli` download). A long-running server still reads the docs once and keeps
 * them until restart — deliberate, since re-checking per call is exactly the
 * ~190 ms network round trip that made `validate_code` slow.
 */
export function resetPlatformOSLiquidDocsManager(): void {
  sharedDocsManager = undefined;
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
