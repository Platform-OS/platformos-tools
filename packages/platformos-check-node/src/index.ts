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
  toLazySourceCode as commonToLazySourceCode,
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
import { overlayFileSystem } from './overlay-file-system';
import { fileURLToPath } from 'node:url';

export * from '@platformos/platformos-check-common';
export * from './config/types';
export { NodeFileSystem };
export { overlayFileSystem } from './overlay-file-system';
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

/** A parsed source file as it appears in an {@link App}. */
export type AppSourceCode = LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode;

/**
 * Read a project file and return its `SourceCode`, with the AST parsed LAZILY (on
 * first access) — see check-common's {@link commonToLazySourceCode}.
 *
 * `getApp` reads every project file so cross-file checks can resolve against a
 * complete `App`, but a `validate_code` request visits only the edited buffer
 * (`CheckOptions.only`), so parsing the rest is work whose result is never read.
 * Deferring it removes that work rather than caching it, and with it the transient
 * ASTs that dominate the server's peak RSS.
 *
 * Behaviour is otherwise unchanged: a read failure still yields `undefined` (the
 * file is dropped from the `App`), and a PARSE failure is still captured as an
 * `Error` on `ast` rather than thrown — it simply surfaces when a check first looks
 * at that file instead of during the load.
 */
export async function toSourceCode(absolutePath: string): Promise<AppSourceCode | undefined> {
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    return commonToLazySourceCode(pathUtils.normalize(URI.file(absolutePath)), source);
  } catch (e) {
    return undefined;
  }
}

/**
 * Per-file change identity: `mtimeMs:ctimeMs:size`. Cheap (a single `stat`).
 * Returns `undefined` when the file cannot be stat'd (e.g. removed between
 * enumeration and this call).
 *
 * `ctimeMs` is what makes this trustworthy, and it is why this is stricter than
 * the usual `mtime:size` pair (TypeScript `--incremental`, bundlers). `mtime` is
 * writable: `utimes` (and therefore `tar -p`, `rsync --times`, `cp -p`, or any
 * build step that pins timestamps) can restore an OLD mtime onto NEW content. If
 * the size also happens to match — an equal-length edit — the pair is unchanged
 * and a stale parse gets reused. That is not theoretical: it was reproduced
 * against this cache, where a same-length `{% doc %}` edit kept serving the
 * previous `@param` list and produced a false "Unknown parameter" offense.
 *
 * `ctimeMs` (inode change time) is updated by the kernel on any write to the file
 * or its metadata and cannot be set by an unprivileged process — `utimes`
 * *advances* it rather than restoring it. So content that changed always yields a
 * different fingerprint.
 *
 * Coarse-granularity filesystems (1 s on some NFS mounts, 2 s on FAT/exFAT) are
 * the other reason to include it: there, two edits inside one tick share an mtime
 * far more easily.
 *
 * Exported so consumers that maintain their own derived caches (e.g. the MCP
 * supervisor's project-graph cache) can share ONE fingerprint definition rather
 * than each inventing their own. Changing this string's shape invalidates every
 * persisted derived cache that stores it, so `CACHE_FORMAT_VERSION` in the
 * supervisor's graph-cache store must be bumped alongside it.
 */
export async function fileFingerprint(absolutePath: string): Promise<string | undefined> {
  try {
    const info = await fs.stat(absolutePath);
    return `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
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
 *
 * PLACEMENT: this belongs in check-node (the lint I/O shell), not
 * platformos-common or the language server, because it caches `getApp`'s output
 * and `getApp` globs the real filesystem — a Node-only concern (common is
 * browser-safe and has no glob). It is the ONLY parsed-project cache in
 * check-node; no pre-existing mechanism duplicates it. The nearest neighbours
 * are deliberately separate: the LSP's `DocumentManager` caches open editor
 * buffers, and the supervisor's `GraphCache` caches the dependency graph —
 * different runtimes and different payloads (parsed lint sources here), so they
 * are not, and should not be, shared.
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
  only?: UriString[],
  /**
   * In-memory buffers to present as existing files. Reference checks
   * (`MissingPartial`, …) resolve names through `context.fs`, NOT through the
   * `App`, so without this a partial that exists only as an unsaved buffer is
   * reported missing. See {@link overlayFileSystem}.
   */
  overlays?: ReadonlyMap<UriString, string>,
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
      fs: overlays ? overlayFileSystem(NodeFileSystem, overlays) : NodeFileSystem,
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
 *
 * Only the buffer's file is VISITED (`CheckOptions.only`), while the complete
 * project is still handed to `check()` so cross-file checks resolve against it.
 * That is a pure speed-up, not a narrowing: offenses are always attributed to the
 * visited file, so visiting the others could only ever produce results this
 * function discards. On a 1400-file project it is the difference between ~21 s
 * and ~0.1 s of check time.
 */
export async function lintBuffer(params: LintBufferParams): Promise<Offense[]> {
  const { root, filePath, content, ...rest } = params;
  const uri = pathUtils.normalize(URI.file(filePath));
  const { offenses } = await lintBuffers({ root, buffers: [{ filePath, content }], ...rest });
  // An ignored buffer yields no offenses, which is what `check()` would have done
  // anyway — the distinction is only meaningful to callers that ASK for it via
  // `lintBuffers`, so this narrower seam keeps its original contract.
  return offenses.get(uri) ?? [];
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
   * The buffers under edit. A later entry for the same path wins, matching
   * "last write for this file", so a caller need not deduplicate.
   */
  buffers: BufferToLint[];
}

/**
 * What a {@link lintBuffers} pass found, and what it did NOT look at.
 *
 * The second half is not a nicety. `check()` skips config-ignored files SILENTLY,
 * so an empty offense list alone cannot distinguish "checked and clean" from "never
 * checked" — and a caller that guesses the first reports a file as validated when
 * nothing examined it. Reporting the fact here, from the config this pass already
 * loaded, is what lets a caller tell them apart without loading the config again
 * and re-deriving an answer this function already knew.
 */
export interface LintBuffersResult {
  /**
   * Offenses per requested buffer URI. A key with an empty array WAS checked and is
   * clean; a requested buffer that is absent from this map was not checked, and
   * `ignored` says why.
   */
  offenses: Map<UriString, Offense[]>;
  /** Requested buffers the project's `ignore` list excludes — not checked at all. */
  ignored: Set<UriString>;
}

/**
 * Lint SEVERAL in-memory buffers in one pass over the project, returning the
 * offenses per buffer keyed by normalized URI plus the buffers the project config
 * excluded (see {@link LintBuffersResult}).
 *
 * WHY THIS IS THE PRIMARY SEAM. Everything expensive here is per-PROJECT, not
 * per-buffer: loading the config, globbing and reconciling the app, building the
 * `getDocDefinition` map, constructing the `JSONValidator`. Linting N buffers one
 * call at a time repeats all of it N times against an unchanged project — measured
 * at ~250 ms of fixed cost against ~84 ms of actual per-buffer work, so a 20-file
 * edit spent most of its time re-discovering the same project twenty times.
 *
 * IT IS ALSO MORE CORRECT, which matters more than the speed. With every buffer
 * overlaid at once, a partial introduced in one buffer resolves for a `render` in
 * another. Linting the same edit file-by-file reports `MissingPartial` for a file
 * that exists in the very batch being checked — a false positive inherent to the
 * single-buffer shape, not a tuning problem.
 *
 * Only the buffers are VISITED (`CheckOptions.only`) while the whole project is
 * handed to `check()`, so cross-file checks still resolve against real files.
 * Offenses are always attributed to the visited file, so visiting the rest could
 * only produce results this function discards.
 */
export async function lintBuffers(params: LintBuffersParams): Promise<LintBuffersResult> {
  const { root, buffers, configPath, cache, log = () => {} } = params;
  const { app, config } = await getAppAndConfig(root, configPath, cache);

  // Deduplicate by URI, last entry winning. Two entries for one file would
  // otherwise overlay twice and double every offense for it.
  const requested = new Map<UriString, string>();
  for (const buffer of buffers) {
    requested.set(pathUtils.normalize(URI.file(buffer.filePath)), buffer.content);
  }

  const offensesByUri = new Map<UriString, Offense[]>();
  const ignored = new Set<UriString>();
  if (requested.size === 0) return { offenses: offensesByUri, ignored };

  // Split off the buffers this project's config excludes, using the config just
  // loaded. Doing it HERE is the whole point: the config is already in hand, and
  // `isIgnored` is consulted once for a fact that would otherwise be re-derived by
  // every caller from its own second config load.
  const overlays = new Map<UriString, string>();
  for (const [uri, content] of requested) {
    if (isIgnored(uri, config)) {
      ignored.add(uri);
      continue;
    }
    overlays.set(uri, content);
    // Seed every LINTED uri so a clean buffer yields [] rather than a missing key —
    // the caller must be able to tell "checked and clean" from "not checked".
    offensesByUri.set(uri, []);
  }

  if (overlays.size === 0) return { offenses: offensesByUri, ignored };

  const overlaidApp = overlayBuffers(app, overlays);
  const offenses = await lintApp(root, overlaidApp, config, log, [...overlays.keys()], overlays);

  for (const offense of offenses) {
    // `only` already restricts the visit to these files; the lookup keeps the
    // partition explicit and independent of that optimization.
    offensesByUri.get(offense.uri)?.push(offense);
  }
  return { offenses: offensesByUri, ignored };
}

/**
 * Return a copy of `app` with each overlaid URI's `SourceCode` replaced by one
 * built from its buffer content, appending any file not already present.
 */
function overlayBuffers(app: App, overlays: ReadonlyMap<UriString, string>): App {
  const seen = new Set<UriString>();
  const next = app.map((file) => {
    const content = overlays.get(file.uri);
    if (content === undefined) return file;
    seen.add(file.uri);
    return commonToSourceCode(file.uri, content);
  });
  for (const [uri, content] of overlays) {
    if (!seen.has(uri)) next.push(commonToSourceCode(uri, content));
  }
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
