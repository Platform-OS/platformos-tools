import {
  AugmentedPlatformOSDocset,
  Config,
  Corrector,
  createCorrector,
  FixDescription,
  flattenFixes,
  GraphQLSourceCode,
  JSONSourceCode,
  LiquidHtmlNode,
  LiquidSourceCode,
  Offense,
  SourceCodeType,
  toSourceCode as commonToSourceCode,
  check as coreCheck,
  isIgnored,
  makeFileExists,
  path as commonPath,
  PROJECT_ROOT_MARKERS,
  ProjectRootResolution,
  resolveProjectRoot,
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
import nodePath from 'node:path';

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
 * Shared rather than respelled because the definition is the part that was hard to get right:
 * `ctime` is in there because `mtime` is settable from userland, so an mtime-restored
 * same-length rewrite is invisible to `mtime:size`, and a second implementation is a second
 * chance to omit it.
 *
 * These caches never compare fingerprints against EACH OTHER — each compares only against its
 * own previous scan — so what is shared is the measured definition and the "could not tell"
 * answer, not a comparison.
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

/**
 * Refuse to run unless `root` really is a project root.
 *
 * WHY THIS IS AN ERROR AND NOT A SILENT EMPTY RESULT. `getAppAndConfig` treats whatever it is
 * handed as the project root. Given a directory that carries no marker — true of `app/` and of any
 * single module directory — it loads zero files, and the run returns zero offenses. Callers print
 * that as "No offenses found", which is indistinguishable from a clean project. Measured on a real
 * app: `check run` reported 1036 offenses across 191 files, while `check run app` on the same
 * project reported none, with a partial containing an unclosed tag sitting inside `app/`.
 *
 * The failure direction is the dangerous one — a developer, a CI job or an agent gating on that
 * message concludes the code is clean when nothing was inspected.
 *
 * IT REPORTS RATHER THAN RESOLVING. Widening the run to the enclosing root would check MORE than
 * was asked: `check run app` would pull in `modules/`, so a run meant for one app reports offenses
 * from vendored code its caller does not own, and a CI job scoped to `app/` starts failing on
 * dependencies. `platformos-graph` can resolve-and-proceed because the graph of a project is the
 * same answer wherever you point at it inside the project; "check this directory" is not.
 * Linting an arbitrary subtree is a separate feature — it would have to load the project anyway,
 * since partials, pages and config all resolve project-wide, and then filter what it reports.
 */
/**
 * A refusal to check, addressed to whoever typed the path — not a crash.
 *
 * Carries a stable `code` rather than relying on `instanceof`, because the consumer that most needs
 * to recognize it (pos-cli) resolves this package independently and may be running an older or
 * newer copy: `error instanceof pkg.ProjectRootError` throws outright when the loaded version does
 * not export the class, turning a friendly message into a different crash. A property check
 * degrades to "unrecognized, print as an error", which is the safe direction.
 */
export class ProjectRootError extends Error {
  readonly code = PROJECT_ROOT_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'ProjectRootError';
  }
}

/** The `code` on {@link ProjectRootError}. Exported so a consumer can match without importing the class. */
export const PROJECT_ROOT_ERROR_CODE = 'PLATFORMOS_PROJECT_ROOT';

/**
 * Why a resolved path cannot be checked, or `undefined` when it can.
 *
 * Pure and exported so both branches are testable against exact strings without depending on what
 * happens to sit above the machine's temp directory — the first version of this test asserted that
 * an OS temp directory is outside any platformOS project, which is a claim about the machine rather
 * than about the code, and it failed on Windows CI where a marker directory exists near the drive
 * root.
 *
 * Deliberately names no tool. The same text reaches a pos-cli user, an editor user through the
 * VS Code extension, and an embedder — so "run pos-cli check run …" would be wrong for two of the
 * three. It states the fact and the path; the caller decides how to phrase the invocation.
 */
export function projectRootRefusal(resolution: ProjectRootResolution): string | undefined {
  if (resolution.isRoot) return undefined;

  const given = commonPath.fsPath(resolution.given);
  if (!resolution.root) {
    return (
      `Nothing was checked: ${given} is not inside a platformOS project.\n` +
      `Looked for ${PROJECT_ROOT_MARKERS.join(', ')} at or above it and found none.`
    );
  }

  return (
    `Nothing was checked: ${given} is not the root of a platformOS project.\n` +
    `Re-run the check against the project root: ${commonPath.fsPath(resolution.root)}`
  );
}

async function assertProjectRoot(root: string): Promise<void> {
  const absolute = nodePath.isAbsolute(root) ? root : nodePath.resolve(process.cwd(), root);
  const resolution = await resolveProjectRoot(absolute, makeFileExists(NodeFileSystem));
  const refusal = projectRootRefusal(resolution);
  if (refusal) throw new ProjectRootError(refusal);
}

export async function appCheckRun(
  root: string,
  configPath?: string,
  log: (message: string) => void = () => {},
): Promise<AppCheckRun> {
  await assertProjectRoot(root);
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
        // The shared AUGMENTED docset, not the raw manager: `check()` skips wrapping an
        // already-augmented one, so this run and any embedder read one object with one
        // set of memos, instead of a fresh wrapper re-expanding the aliases per run.
        platformosDocset: getPlatformOSDocset(),
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
 * Every loader on `PlatformOSLiquidDocsManager` — including `setup()`, which makes a NETWORK
 * call to compare the local docs revision against the remote one — is a per-instance memo, so
 * one per lint run re-does that check and re-parses the docset every time. Reusing one instance
 * is what makes those memos pay off, and keeping the SDL string stable is what lets
 * check-common's schema cache hit.
 *
 * Reuse is time-boxed rather than permanent, because those memos also pin whatever each
 * resource resolved to on first use — including the bundled fallback a loader settles for when
 * the cache directory is missing. That fallback is a complete docset, so the cost is staleness,
 * not breakage; rebuilding after {@link DOCS_MANAGER_MAX_AGE_MS} picks up a new revision.
 */
let sharedDocsManager: PlatformOSLiquidDocsManager | undefined;
/**
 * The augmented view of {@link sharedDocsManager} — THE docset for this process.
 *
 * Built beside the manager and discarded with it, so the alias expansion and the
 * per-method memos live exactly as long as the data they describe.
 *
 * `check()` only wraps a docset that is not already augmented (it tests `isAugmented`),
 * so handing it this one means a lint and an embedder read the SAME object: one alias
 * expansion, one set of memos, and no way for two wrappers over the same manager to
 * answer differently. Before this existed, every run built a fresh wrapper and
 * re-expanded the aliases.
 */
let sharedDocset: AugmentedPlatformOSDocset | undefined;
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
  sharedDocset = undefined;
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
    sharedDocset = undefined;
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
    sharedDocset = undefined;
  }

  return sharedDocsManager;
}

/**
 * THE platformOS docset for this process — the same object the lint reads from.
 *
 * Exported for embedders that need to answer a question ABOUT the vocabulary rather than about
 * a file. The MCP supervisor renders these into the explanation it gives an agent, and it must
 * be reading the same `filters.json` / `tags.json` the offense it is explaining came from.
 *
 * **Do not construct a `PlatformOSLiquidDocsManager` to get one.** Every loader on it is a
 * per-instance memo and `setup()` makes a NETWORK call, so a second instance re-pays all of it
 * and can settle on a different revision than the lint used. This accessor exists precisely so
 * no consumer needs the docs-updater package as a dependency of its own.
 *
 * The instance is rebuilt on the same schedule as the manager, so hold the result for a call,
 * not for the process.
 */
export function getPlatformOSDocset(): AugmentedPlatformOSDocset {
  const manager = getPlatformOSLiquidDocsManager();
  if (!sharedDocset) sharedDocset = new AugmentedPlatformOSDocset(manager);
  return sharedDocset;
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

/**
 * An offense's `fix` and `suggest`, run to produce the CONCRETE edits they describe.
 *
 * WHY THIS IS DONE HERE AND NOT BY THE CALLER. `Offense.fix` is a `Fixer` function, and a
 * fixer may read back through the `App` — `missing-doc-param`'s reads `file.source` to
 * match the surrounding indentation. That only works while the file is still loaded and
 * still carries the buffer's overlay. Run afterwards it either THROWS (`AppFile source
 * read before it was loaded`) or, worse, silently computes against the text on DISK, which
 * is not the text the offense describes.
 *
 * So the fixers run beside the lint that produced them, and callers receive data.
 */
export interface MaterialisedFix {
  /** Concrete edits for `Offense.fix`, when it had one. */
  fix?: FixDescription[];
  /** One entry per `Offense.suggest`, keeping the engine's own wording. */
  suggestions?: Array<{ message: string; edits: FixDescription[] }>;
}

export interface LintBufferResult {
  status: LintBufferStatus;
  /** The buffer file's offenses. Always empty unless `status` is `checked`. */
  offenses: Offense[];
  /**
   * The concrete edits for each entry of {@link offenses}, index-aligned with it.
   *
   * Always the same length as `offenses`; an offense the engine offered nothing for gets
   * an empty object, so the alignment never depends on which offenses had fixes.
   */
  fixes: MaterialisedFix[];
  /**
   * The Liquid AST **of the content that was actually checked**.
   *
   * RETURNED, NOT LOOKED UP AFTERWARDS. The overlay this call installs is reverted in a
   * `finally`, so a caller that reads the `App` afterwards gets whatever is on DISK. For a
   * buffer that differs from disk — the entire point of this seam — that AST describes
   * different text than the offenses do, so resolving an offense's range against it lands on
   * the wrong node, and only for edited files. So the AST is captured inside the overlay and
   * handed back with the offenses that share its coordinates.
   *
   * Present only for a `checked` LiquidHtml buffer that PARSED. Absent for GraphQL, YAML and
   * assets, and absent when the parse failed — so `ast` present means "these offenses and this
   * tree describe the same text".
   */
  ast?: LiquidHtmlNode;
}

/**
 * Lint a single in-memory buffer in the context of its on-disk project.
 *
 * The typed seam the MCP supervisor lints through — NOT an LSP, NOT a subprocess. The on-disk
 * project is loaded so cross-file checks resolve against real files, and the buffer under edit
 * is overlaid in memory so the UNSAVED content is what gets linted. Returns the structured
 * check-common `Offense[]` with `fix` / `suggest` and all typed fields preserved end to end.
 *
 * **It also says whether it checked the file at all**, via {@link LintBufferStatus}: four kinds
 * of path are never linted, and an empty `Offense[]` for any of them is indistinguishable from
 * a clean file.
 *
 * `filePath` must be absolute. When it already exists in the project its on-disk `SourceCode`
 * is replaced by the buffer; when it is new the buffer is added so it is still linted.
 *
 * Only the buffer's file is VISITED (`CheckOptions.only`) while the complete project is still
 * handed to `check()`. That is a pure speed-up, not a narrowing: offenses are always attributed
 * to the visited file.
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
 * THE PRIMARY SEAM, with {@link lintBuffer} delegating to it. Everything expensive is
 * per-PROJECT — resolving the config, walking and reconciling the shared `App`, reconciling the
 * route table — so linting N buffers one call at a time repeats all of it against an unchanged
 * project.
 *
 * IT IS ALSO MORE CORRECT, which matters more: with every buffer overlaid at once, a partial
 * introduced in one resolves for a `render` in another, where file-by-file linting reports
 * `MissingPartial` for a file that exists in the very batch being checked.
 *
 * Every buffer gets its OWN {@link LintBufferResult}, so a batch mixing an asset, an ignored
 * path and two real sources answers each on its own terms.
 *
 * Only the buffers are VISITED (`CheckOptions.only`) while the whole project stays visible to
 * cross-file checks.
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
      results.set(uri, { status: 'checked', offenses: [], fixes: [] });
      visit.push(uri);
    }

    if (visit.length > 0) {
      for (const offense of await lintApp(app, config, log, visit)) {
        // `only` already restricts the visit to these files; the lookup keeps the
        // partition explicit and independent of that optimization.
        const result = results.get(offense.uri);
        if (!result) continue;
        result.offenses.push(offense);
        // Pushed in the SAME step, so the two arrays cannot get out of step, and INSIDE
        // the try, so a fixer that reads the file sees the buffer rather than disk.
        result.fixes.push(materialiseFixes(offense, log));
      }

      // INSIDE the try, so the overlay is still installed and these are the buffers'
      // own trees — see `LintBufferResult.ast`. Free: the lint above already parsed
      // each visited file, and `AppFile.ast` is memoized per version, so this reads
      // the same object rather than parsing again.
      for (const uri of visit) {
        const file = app.get(uri);
        // The FILE's type decides, not the shape of the value: `AppFile.ast` is
        // `unknown` and a YAML file's tree would duck-type its way past a node check.
        if (file?.type !== SourceCodeType.LiquidHtml) continue;
        // An `Error` VALUE, not a throw — an unparseable file is data here. Skipping it
        // is what makes "`ast` present" mean "there is a tree to resolve against".
        const parsed = file.ast;
        if (parsed instanceof Error) continue;
        results.get(uri)!.ast = parsed as LiquidHtmlNode;
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
  return { status, offenses: [], fixes: [] };
}

/**
 * Source types whose fixers can be run at all.
 *
 * `createCorrector` THROWS for YAML and JSON — neither has autofix — so it is asked
 * before the call rather than left to {@link runFixer}'s catch. The two are not
 * interchangeable: this is a KNOWN non-fault with a correct answer (no fix exists),
 * while a throw inside a fixer is a bug, and the catch below logs it as one.
 */
function isFixableSourceType(type: SourceCodeType): boolean {
  return type === SourceCodeType.LiquidHtml || type === SourceCodeType.GraphQL;
}

/**
 * Run one fixer against a fresh corrector and collect what it recorded.
 *
 * A THROW COSTS THIS FIXER AND NOTHING ELSE. Fixers are enrichment — the offense is already
 * found, positioned and worded — so letting an exception out would take the whole batch with
 * it, out of `lintBuffers`, whose only `try` is the overlay's `finally`. Not hypothetical:
 * `missing-doc-param`'s fixer calls `indentationOfLineAt`, which throws whenever it runs
 * outside the overlay.
 *
 * The fault is LOGGED rather than swallowed, so a broken fixer stays visible. Nothing partial
 * is returned: a fixer that recorded two of the three edits it needed produces a fix that
 * corrupts the file, which is worse than no fix.
 */
function runFixer(
  offense: Offense,
  fixer: (corrector: Corrector<SourceCodeType>) => void,
  log: (message: string) => void,
): FixDescription[] {
  // A FRESH corrector per fixer. A corrector ACCUMULATES, so sharing one across an
  // offense's `fix` and its suggestions would give the second option the first one's
  // edits as well. `autofix` shares one deliberately — it applies a whole file at once —
  // and that is the opposite of what a caller offering choices needs.
  const corrector = createCorrector(offense.type, '');
  try {
    fixer(corrector as never);
  } catch (error: unknown) {
    log(
      `lintBuffers: the ${offense.check} fixer threw on ${offense.uri}, so that offense is ` +
        `reported without it: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
  return flattenFixes(corrector.fix);
}

/**
 * Turn an offense's `fix` / `suggest` into concrete edits. See {@link MaterialisedFix}.
 *
 * The corrector is built with an EMPTY source: a `StringCorrector` records
 * `{startIndex, endIndex, insert}` triples and never reads the string it was constructed with.
 * A fixer that needs surrounding text reads it from the `AppFile`, which is why this must run
 * while that file is loaded and overlaid.
 *
 * EAGER, for every offense, and it has to be: the fixers can only run while the overlay is
 * installed. Measured at ~1 µs per fixer — 5.7 ms for the 4,566 fixers of a 12,877-offense
 * project — so "materialise only what survives" is not worth the invariant it would break.
 *
 * A fixer that records NOTHING is dropped rather than reported as an empty fix, because
 * `AgentFix.edits` promises to be non-empty. That also drops a `Suggestion`'s wording, measured
 * unreachable across three real projects.
 */
function materialiseFixes(offense: Offense, log: (message: string) => void): MaterialisedFix {
  if (!isFixableSourceType(offense.type)) return {};

  const materialised: MaterialisedFix = {};
  if (offense.fix) {
    const edits = runFixer(offense, offense.fix as (c: Corrector<SourceCodeType>) => void, log);
    if (edits.length > 0) materialised.fix = edits;
  }

  const suggestions = (offense.suggest ?? [])
    .map((suggestion) => ({
      message: suggestion.message,
      edits: runFixer(offense, suggestion.fix as (c: Corrector<SourceCodeType>) => void, log),
    }))
    .filter((suggestion) => suggestion.edits.length > 0);
  if (suggestions.length > 0) materialised.suggestions = suggestions;

  return materialised;
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
 * The app for `config`: walk the project, reconcile the process's {@link AppModel} with what
 * the walk found, and read NOTHING.
 *
 * The files are {@link AppModel} files, so each reads its source on the first `load()` and
 * parses on the first `ast`. The app itself is shared per process and reconciled per call
 * rather than rebuilt (see `shared-app.ts`); what the WALK finds is never cached, so a file
 * added, edited or deleted between two calls is reflected in the next one.
 *
 * A parse error is surfaced as a captured `Error` on that file's `ast`, produced when the file
 * is first read, so an unparseable file nobody visits costs nothing.
 */
export async function getApp(config: Config): Promise<AppModel> {
  const paths = await getAppFilePaths(config);
  return getSharedApp(config.rootUri, paths, nodeParsers);
}

/**
 * Every path in the project that COULD be a platformOS source, as a URI.
 *
 * Candidates, not app files: which of them the app contains is `parseAppPath`'s answer, and
 * this function deliberately knows nothing about the platformOS directory structure.
 *
 * The user's `ignore` is deliberately NOT applied: an ignored file is an ordinary part of the
 * app, and `ignore` only silences the offenses REPORTED on it, which is `check()`'s job.
 *
 * Path work only — no `stat`, no read. The walk is {@link walkAppSourceFiles}, anchored on
 * `APP_SOURCE_SUBTREES` so it never enumerates the rest of the repository.
 */
async function getAppFilePaths(config: Config): Promise<UriString[]> {
  return walkAppSourceFiles(NodeFileSystem, config.rootUri, ([uri]) =>
    SOURCE_FILE_EXTENSIONS.some((extension) => uri.endsWith(extension)),
  );
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
