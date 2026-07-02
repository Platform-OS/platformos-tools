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

/** A parsed source file as it appears in an {@link App}. */
export type AppSourceCode = LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode;

export async function toSourceCode(absolutePath: string): Promise<AppSourceCode | undefined> {
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    return commonToSourceCode(pathUtils.normalize(URI.file(absolutePath)), source);
  } catch (e) {
    return undefined;
  }
}

/**
 * Per-file change identity: `mtimeMs:size`. Cheap (a single `stat`) and standard
 * (TypeScript `--incremental`, bundlers use the same). Returns `undefined` when
 * the file cannot be stat'd (e.g. removed between enumeration and this call).
 *
 * Exported so consumers that maintain their own derived caches (e.g. the MCP
 * supervisor's project-graph cache) can share ONE fingerprint definition rather
 * than each inventing their own.
 */
export async function fileFingerprint(absolutePath: string): Promise<string | undefined> {
  try {
    const info = await fs.stat(absolutePath);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return undefined;
  }
}

/**
 * An OPT-IN, caller-held cache of parsed project sources for {@link getApp}.
 *
 * The whole-project parse is the dominant cost of a `lintBuffer` call (seconds
 * on a large project). A caller that lints the same project repeatedly (the MCP
 * supervisor) holds one `AppCache` and passes it to `getApp`/`lintBuffer`, so
 * unchanged files are reused and only changed/new files are re-parsed.
 *
 * NEVER stale: reuse is gated on the per-file {@link fileFingerprint}; a changed
 * file (mtime/size moved) is re-parsed, a removed file is pruned, an added file
 * is parsed. Passing no cache preserves the original parse-everything behaviour
 * exactly — existing consumers (CLI, backfill) are unaffected.
 */
export class AppCache {
  private readonly entries = new Map<string, { fingerprint: string; source: AppSourceCode }>();

  /** Number of cached parsed files. */
  get size(): number {
    return this.entries.size;
  }

  /** The cached parse for `uri` when its fingerprint still matches, else undefined. */
  reuse(uri: string, fingerprint: string): AppSourceCode | undefined {
    const entry = this.entries.get(uri);
    return entry && entry.fingerprint === fingerprint ? entry.source : undefined;
  }

  /** Store (or replace) the parse for `uri` at `fingerprint`. */
  store(uri: string, fingerprint: string, source: AppSourceCode): void {
    this.entries.set(uri, { fingerprint, source });
  }

  /** Drop any cached file not in `keep` (removed from the project). */
  prune(keep: ReadonlySet<string>): void {
    for (const uri of this.entries.keys()) {
      if (!keep.has(uri)) this.entries.delete(uri);
    }
  }

  /** Forget everything (explicit full invalidation). */
  clear(): void {
    this.entries.clear();
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
  /**
   * Optional parsed-project cache. When passed, the on-disk project is reused
   * across calls and only changed files are re-parsed (never stale — see
   * {@link AppCache}). Omit for the original parse-everything behaviour.
   */
  cache?: AppCache;
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
  const { root, filePath, content, configPath, cache, log = () => {} } = params;
  const { app, config } = await getAppAndConfig(root, configPath, cache);
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
  cache?: AppCache,
): Promise<{ app: App; config: Config }> {
  const config = await loadConfig(configPath, root);
  const app = await getApp(config, cache);
  return {
    app,
    config,
  };
}

const isDefinedSource = (x: AppSourceCode | undefined): x is AppSourceCode => x !== undefined;

/**
 * Load and parse every platformOS source file for `config`.
 *
 * When a {@link AppCache} is passed, unchanged files (by {@link fileFingerprint})
 * are reused instead of re-parsed and only changed/new files are parsed — the
 * file set + config-driven filter are still re-evaluated every call, so the
 * result can never be stale. Without a cache the behaviour is unchanged: every
 * file is parsed.
 */
export async function getApp(config: Config, cache?: AppCache): Promise<App> {
  const paths = await getAppFilePaths(config);

  if (!cache) {
    const sourceCodes = await Promise.all(paths.map(toSourceCode));
    return sourceCodes.filter(isDefinedSource);
  }

  const keep = new Set<string>();
  const sourceCodes = await Promise.all(
    paths.map(async (filePath): Promise<AppSourceCode | undefined> => {
      const uri = pathUtils.normalize(URI.file(filePath));
      keep.add(uri);
      const fingerprint = await fileFingerprint(filePath);
      if (fingerprint === undefined) return undefined; // vanished between glob and stat
      const reused = cache.reuse(uri, fingerprint);
      if (reused) return reused;
      const source = await toSourceCode(filePath);
      if (source) cache.store(uri, fingerprint, source);
      return source;
    }),
  );
  cache.prune(keep);
  return sourceCodes.filter(isDefinedSource);
}

/**
 * The absolute, normalized paths of every platformOS source file for `config`
 * (glob + the recognized-directory filter). This is the file-set discovery the
 * app is built from; the config-driven `isIgnored` filter is applied here so a
 * config change is reflected in the returned set.
 */
async function getAppFilePaths(config: Config): Promise<string[]> {
  // On windows machines - the separator provided by path.join is '\'
  // however the glob function fails silently since '\' is used to escape glob charater
  // as mentioned in the documentation of node-glob

  // the path is normalised and '\' are replaced with '/' and then passed to the glob function
  const normalizedGlob = getAppFilesPathPattern(config.rootUri);

  return glob(normalizedGlob, { absolute: true }).then((result) =>
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
}

export function getAppFilesPathPattern(rootUri: string) {
  return normalize(path.join(fileURLToPath(rootUri), '**/*.{liquid,graphql,yml,yaml}'));
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
