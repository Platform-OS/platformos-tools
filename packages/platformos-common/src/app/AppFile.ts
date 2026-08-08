import { AbstractFileSystem, UriString } from '../AbstractFileSystem';
import {
  AppPathInfo,
  formatRank,
  isParsedFileType,
  parseAppPath,
  pathToName,
  PlatformOSFileType,
} from '../path-utils';
import { Parser, Parsers, SourceCodeType, extensionOf, sourceCodeTypeOf } from './types';
import { joinUri, normalizeUri, relativeUriPath } from './uri';

/**
 * One file of a platformOS app: where it lives, what the platform does with it,
 * what other files call it, and — only if someone asks — its source and AST.
 *
 * Two properties carry the whole design:
 *
 * 1. **Construction does no I/O.** Everything about a file's identity comes from
 *    its path. {@link load} is what reads; {@link ast} is what parses.
 * 2. **{@link ast} is synchronous.** Checks read `file.ast` inline
 *    (`visitLiquid(file.ast, check)`), so making the parse async would touch every
 *    check in the toolchain. Only the read is async: a consumer `await`s
 *    {@link load} for the files it will touch, then reads `ast` synchronously.
 *    Same split as Ruby's `source` / `parse`.
 *
 * The shape (`uri`, `type`, `source`, `ast`, `version`) is deliberately the
 * structural `SourceCode` every existing check already consumes, so files can be
 * handed straight to `check()`.
 */
export class AppFile {
  /** The normalized `file://` URI of this file. */
  readonly uri: UriString;

  /** The project root this file's {@link relativePath} and {@link name} are relative to. */
  readonly rootUri: UriString;

  /** Forward-slashed path from the project root, e.g. `app/views/partials/ui/card.liquid`. */
  readonly relativePath: string;

  /** What the platform does with this file on deploy. */
  readonly fileType: PlatformOSFileType;

  /** What the file's contents are parsed as, or `undefined` for a file no check models. */
  readonly type: SourceCodeType | undefined;

  /**
   * The logical name other files refer to this one by — what goes inside
   * `{% render '…' %}`, `{% function … = '…' %}`, `{% graphql … = '…' %}` — and
   * the key {@link App}'s per-type index is built on.
   *
   * It is the path with its type's directory prefix stripped and its extension
   * removed, prefixed with `modules/<name>/` for a module file, all derived from
   * `FILE_TYPE_DIRS`.
   *
   * A field rather than a getter: `App` reads it four times per insert and remove,
   * and deriving it means re-parsing the path.
   *
   * @example 'app/views/partials/ui/card.liquid'                  → 'ui/card'
   * @example 'app/lib/commands/create.liquid'                     → 'commands/create'
   * @example 'modules/core/public/views/partials/card.liquid'      → 'modules/core/card'
   * @example 'app/modules/core/public/views/partials/card.liquid'  → 'modules/core/card'
   */
  readonly name: string;

  /** Everything the directory structure says about this path. */
  protected readonly pathInfo: AppPathInfo;

  private readonly fs: AbstractFileSystem;
  private readonly parsers: Parsers;

  private loadedSourceValue: string | undefined;
  private loadPromise: Promise<void> | undefined;
  private parsed: unknown;
  private hasParsed = false;
  private derivedValues: Map<string, unknown> | undefined;
  private versionValue: number | undefined;
  private lastTouchValue = 0;
  private revisionValue = ++contentClock;

  /**
   * Takes its identity ALREADY DERIVED, because {@link createAppFile} had to derive it
   * to decide there was a file here at all.
   */
  constructor(identity: AppFileIdentity, fs: AbstractFileSystem, parsers: Parsers = {}) {
    this.uri = identity.uri;
    this.rootUri = identity.rootUri;
    this.relativePath = identity.relativePath;
    this.pathInfo = identity.pathInfo;
    this.fileType = identity.pathInfo.fileType;
    this.name = identity.name;
    this.fs = fs;
    this.parsers = parsers;
    // BOTH facts, and this is the only place that holds both: what the platform makes of
    // the path, and whether we have a parser for its spelling. An ASSET is served
    // verbatim, so it has no type however parseable its extension looks — a bare
    // `.liquid` under `assets/` has no response format and would otherwise fall back to
    // `html.liquid` and be linted like a page. `undefined` is already the whole of "do
    // not parse this" throughout the toolchain, so saying it here is what makes every
    // consumer agree without any of them knowing the rule. See `isParsedFileType`.
    this.type = isParsedFileType(this.fileType) ? sourceCodeTypeOf(this.uri) : undefined;
  }

  // ─── Identity ───────────────────────────────────────────────────────────────

  /** The module this file belongs to, or `undefined` for an app-level file. */
  get moduleName(): string | undefined {
    return this.pathInfo.moduleName;
  }

  /** True for a file under `modules/<name>/…`, which an `app/modules/<name>/…` copy can shadow. */
  get isModuleOriginal(): boolean {
    return this.moduleName !== undefined && !this.pathInfo.isModuleOverwrite;
  }

  /**
   * True for a file under `app/modules/<name>/…`.
   *
   * That is where you overwrite an installed module's file: copy it to the EXACT same
   * path inside `app/`, and the platform prefers your copy on deploy while both files
   * stay in the repository. It is also where a module internal to the application
   * lives, and the two are indistinguishable from the path alone — so this means
   * "would shadow a `modules/<name>/…` file of the same name, if one existed".
   */
  get isModuleOverwrite(): boolean {
    return this.pathInfo.isModuleOverwrite;
  }

  /** Where the `modules/<name>/…` original this file overwrites would live. */
  get moduleOriginalUri(): UriString | undefined {
    if (!this.isModuleOverwrite) return undefined;
    return joinUri(this.rootUri, this.relativePath.replace(/^app\//, ''));
  }

  /** Where an `app/modules/<name>/…` overwrite of this original would live. */
  get moduleOverwriteUri(): UriString | undefined {
    if (!this.isModuleOriginal) return undefined;
    return joinUri(this.rootUri, 'app', this.relativePath);
  }

  /**
   * Where this file's directory sits in the candidate list `DocumentsLocator`
   * walks for its type, so that "first candidate that exists wins" becomes a
   * comparison. `undefined` means no candidate path covers it, which is also why
   * the walk would never find it.
   */
  get searchPathIndex(): number | undefined {
    return this.pathInfo.searchPathIndex;
  }

  /**
   * Where this file's format spelling sits among its name's candidates within one
   * directory — `0` for plain, `1` for `.html`, … The index's tiebreak between
   * same-name, same-directory files, so it picks the file a candidate walk would.
   */
  get formatRank(): number {
    return formatRank(this.fileType, this.pathInfo.rest);
  }

  // ─── Contents ───────────────────────────────────────────────────────────────

  /**
   * The client-side document version for an editor buffer, or `undefined` for
   * content that came from disk. Several language-server features read this to
   * tell "open in the editor" from "on disk".
   */
  get version(): number | undefined {
    return this.versionValue;
  }

  /** Whether this file's source is in memory, i.e. whether {@link source} and {@link ast} can be read. */
  get loaded(): boolean {
    return this.loadedSourceValue !== undefined;
  }

  /**
   * When this file was last USED — its position on a process-wide logical clock,
   * bumped by every {@link load} (including one that found the source already in
   * memory), every {@link ast} read, and every {@link setSource}.
   *
   * This is the signal a retention policy needs and `loaded` alone cannot give: to
   * `loaded`, a file consulted on every call looks identical to one nobody touched
   * again, so evicting by read order throws out the working set. check-node's shared
   * app evicts in `lastTouch` order for that reason.
   */
  get lastTouch(): number {
    return this.lastTouchValue;
  }

  /**
   * WHICH CONTENTS this file is holding — a position on a process-wide logical clock,
   * moved by every {@link setSource} and every {@link invalidate}, and by nothing else.
   *
   * It is what lets an analysis somewhere ELSE record what it read and check later
   * whether that is still true, without keeping a copy of it. Two numbers compare in
   * constant time and synchronously; the alternative is re-reading every file the
   * analysis touched, on every cache hit, through whichever read path the memo's owner
   * happened to pick — and picking a different one from the analysis is precisely the
   * defect this exists to make unspellable.
   *
   * GLOBAL AND MONOTONIC, not per-file. `App.update` REPLACES the file object for a URI
   * (its read and parse are stale by definition), and a per-file counter would restart
   * at zero on the replacement — so a recording made against the old file would compare
   * equal to a brand new one and be trusted. A global clock cannot hand a later file an
   * earlier number, so "same revision" means "same contents" for the whole process.
   *
   * NOT {@link lastTouch}, which moves on every READ: a memo validated against that
   * would miss on every hit, since asking is itself a touch.
   */
  get revision(): number {
    return this.revisionValue;
  }

  /**
   * The source if it is already in memory, `undefined` otherwise.
   *
   * This is the read for callers that want to *prefer* an in-memory buffer over
   * what is on disk without forcing a read — an unsaved editor buffer takes
   * precedence, an unloaded file falls through to the filesystem.
   */
  get loadedSource(): string | undefined {
    return this.loadedSourceValue;
  }

  /**
   * The file's contents.
   *
   * Throws when the file has not been loaded, deliberately: a silent `''` would turn
   * "nobody awaited `load()`" into wrong lint results, which is far harder to find
   * than a stack trace naming the file.
   */
  get source(): string {
    if (this.loadedSourceValue === undefined) {
      throw new Error(
        `AppFile source read before it was loaded: ${this.uri}. ` +
          `Await load() (or App.load()) for every file you intend to read.`,
      );
    }
    return this.loadedSourceValue;
  }

  /**
   * The parsed representation of {@link source}, or an `Error` VALUE when the source
   * does not parse or no parser is registered. Memoized per version, and never throws
   * — checks report unparseable files, so that is data, not an exception.
   */
  get ast(): unknown {
    this.lastTouchValue = ++touchClock;
    if (!this.hasParsed) {
      this.parsed = this.parse(this.source);
      this.hasParsed = true;
    }
    return this.parsed;
  }

  /**
   * A value DERIVED from this file — an analysis of its parse — memoized for exactly as long
   * as the parse is, and dropped by the same two places that drop it.
   *
   * WHY IT LIVES HERE. The alternative is a module-level cache in whichever package computes
   * the analysis, keyed on the file's CONTENT so it cannot go stale. That works, and it costs
   * a second copy of every source it has ever seen plus an eviction policy to bound them. This
   * file already holds the source and the parse, already knows when they stop being true, and
   * the {@link App} already evicts the files nobody is using — so hanging the analysis off it
   * needs no key, no copy and no eviction of its own.
   *
   * `key` distinguishes analyses, and must include whatever the computation depends on BEYOND
   * this file: `undefinedVariables` reads a list of in-scope global names, so that list is part
   * of its key. Anything else is a stale answer.
   *
   * `unknown` for the same reason {@link ast} is: this package sits below the packages that
   * define these analyses, so it stores them without knowing what they are.
   */
  derived<T>(key: string, compute: () => T): T {
    this.lastTouchValue = ++touchClock;
    this.derivedValues ??= new Map();
    if (!this.derivedValues.has(key)) this.derivedValues.set(key, compute());
    return this.derivedValues.get(key) as T;
  }

  /** Read this file's source into memory. At most one read per version, however many callers await it. */
  async load(): Promise<void> {
    this.lastTouchValue = ++touchClock;
    if (this.loadedSourceValue !== undefined) return;
    if (!this.loadPromise) {
      this.loadPromise = this.fs
        .readFile(this.uri)
        .then((source) => {
          // A setSource() that landed while the read was in flight is newer than
          // what came back from disk, so it wins.
          if (this.loadedSourceValue === undefined) this.loadedSourceValue = source;
        })
        .finally(() => {
          this.loadPromise = undefined;
        });
    }
    return this.loadPromise;
  }

  /**
   * Replace this file's contents in memory — an editor buffer, or the file being
   * validated before it is written. Drops the cached parse, so the next
   * {@link ast} read reflects the new source.
   *
   * `version` follows the language-server convention: a number for an open
   * document, `undefined` for content that represents what is on disk.
   */
  setSource(source: string, version?: number): void {
    this.lastTouchValue = ++touchClock;
    this.revisionValue = ++contentClock;
    this.loadedSourceValue = source;
    this.versionValue = version;
    this.parsed = undefined;
    this.hasParsed = false;
    this.derivedValues = undefined;
  }

  /**
   * Forget the source and the parse, so the next {@link load} reads from disk again.
   * The whole invalidation story for a file that changed underneath us: drop it and
   * let laziness decide whether it is worth re-reading.
   */
  invalidate(): void {
    this.revisionValue = ++contentClock;
    this.loadedSourceValue = undefined;
    this.versionValue = undefined;
    this.parsed = undefined;
    this.hasParsed = false;
    this.derivedValues = undefined;
    this.loadPromise = undefined;
  }

  // ─── Extension points ───────────────────────────────────────────────────────

  /** Resolve the parser for this file, by source-code type first and by extension second. */
  private get parser(): Parser | undefined {
    const byType = this.type && this.parsers[this.type];
    return byType ?? this.parsers.extensions?.[extensionOf(this.uri)];
  }

  private parse(source: string): unknown {
    const parser = this.parser;
    if (!parser) {
      return new Error(`No parser registered for ${this.uri}`);
    }
    try {
      return parser(source, this.uri);
    } catch (error) {
      // A parser is contracted to RETURN its errors. One that throws anyway must
      // not take a whole lint run with it.
      return error instanceof Error ? error : new Error(String(error));
    }
  }
}

/**
 * The process-wide logical clock behind {@link AppFile.lastTouch}: strictly
 * monotonic across every `AppFile` of every `App`, so "touched more recently"
 * is a plain number comparison with no wall-clock semantics to get wrong.
 */
let touchClock = 0;

/**
 * The process-wide logical clock behind {@link AppFile.revision}. Separate from
 * {@link touchClock} because they answer different questions: that one moves when a file
 * is USED, this one only when what it holds CHANGES.
 */
let contentClock = 0;

/** Everything about a file that follows from its path alone, derived once. */
export interface AppFileIdentity {
  /** The normalized `file://` URI. */
  uri: UriString;
  /** The normalized project root the rest of these are relative to. */
  rootUri: UriString;
  /** Forward-slashed path from the project root. */
  relativePath: string;
  /** The logical name references spell — see {@link AppFile.name}. */
  name: string;
  /** What {@link parseAppPath} made of {@link relativePath}. */
  pathInfo: AppPathInfo;
}

/**
 * Build the {@link AppFile} for `uri`, or `undefined` when the URI is not in a
 * recognized platformOS directory and so is not part of the app at all.
 *
 * Classification is ANCHORED under `rootUri`: a file belongs to the app only if it
 * sits at `{app,marketplace_builder}/{dir}/…` or
 * `[app/]modules/<name>/{public,private}/{dir}/…` relative to the root. Matching a
 * known directory ANYWHERE in the path is not enough.
 */
export function createAppFile(
  uri: UriString,
  rootUri: UriString,
  fs: AbstractFileSystem,
  parsers: Parsers = {},
): AppFile | undefined {
  const normalizedUri = normalizeUri(uri);
  const normalizedRoot = normalizeUri(rootUri);
  const relativePath = relativeUriPath(normalizedUri, normalizedRoot);

  const pathInfo = parseAppPath(relativePath);
  if (pathInfo === undefined) return undefined;

  return new AppFile(
    {
      uri: normalizedUri,
      rootUri: normalizedRoot,
      relativePath,
      // Resolves for every path `parseAppPath` classified, which is all that gets here.
      name: pathToName(relativePath)!.name,
      pathInfo,
    },
    fs,
    parsers,
  );
}
