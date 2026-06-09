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
  memo,
  path as pathUtils,
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
): Promise<Offense[]> {
  const platformOSLiquidDocsManager = new PlatformOSLiquidDocsManager(log);

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

  return coreCheck(app, config, {
    fs: NodeFileSystem,
    platformosDocset: platformOSLiquidDocsManager,
    jsonValidationSet: platformOSLiquidDocsManager,
    getDocDefinition: async (relativePath) => docDefinitions.get(relativePath)?.(),
  });
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
 */
export async function lintBuffer(params: LintBufferParams): Promise<Offense[]> {
  const { root, filePath, content, configPath, log = () => {} } = params;
  const { app, config } = await getAppAndConfig(root, configPath);
  const uri = pathUtils.normalize(URI.file(filePath));
  const overlaidApp = overlayBuffer(app, uri, content);
  const offenses = await lintApp(root, overlaidApp, config, log);
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
  return normalize(path.join(fileURLToPath(rootUri), '**/*.{liquid,json,graphql,yml,yaml}'));
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
