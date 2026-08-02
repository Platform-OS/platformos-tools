import { AbstractFileSystem, UriString } from '../AbstractFileSystem';
import { AppPathInfo, parseAppPath, pathToName, PlatformOSFileType } from '../path-utils';
import { Parser, Parsers, SourceCodeType, extensionOf, sourceCodeTypeOf } from './types';
import { normalizeUri, relativeUriPath } from './uri';

/**
 * One file of a platformOS app: where it lives, what the platform does with it,
 * what other files call it, and — only if someone asks — its source and AST.
 *
 * Two properties carry the whole design:
 *
 * 1. **Construction does no I/O.** Everything about a file's identity comes from
 *    its path, so classifying a 1400-file project is regex work, not 1400 reads
 *    and 1400 parses. {@link load} is what reads; {@link ast} is what parses.
 * 2. **{@link ast} is synchronous.** Checks read `file.ast` inline
 *    (`visitLiquid(file.ast, check)`), so making the parse async would touch every
 *    check in the toolchain. Instead the async step is only the read: a consumer
 *    `await`s {@link load} for the files it will touch, then reads `ast`
 *    synchronously. This is the same `source`-lazy / `parse`-memoized split the
 *    Ruby implementation uses.
 *
 * The shape (`uri`, `type`, `source`, `ast`, `version`) is deliberately the
 * structural `SourceCode` every existing check already consumes, so files can be
 * handed straight to `check()`.
 */
export abstract class AppFile {
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

  /** Everything the directory structure says about this path, when it is anchored under a known root. */
  protected readonly pathInfo: AppPathInfo | undefined;

  private readonly fs: AbstractFileSystem;
  private readonly parsers: Parsers;

  private loadedSourceValue: string | undefined;
  private loadPromise: Promise<void> | undefined;
  private parsed: unknown;
  private hasParsed = false;
  private versionValue: number | undefined;

  constructor(
    uri: UriString,
    rootUri: UriString,
    fileType: PlatformOSFileType,
    fs: AbstractFileSystem,
    parsers: Parsers = {},
  ) {
    this.uri = normalizeUri(uri);
    this.rootUri = normalizeUri(rootUri);
    this.relativePath = relativeUriPath(this.uri, this.rootUri);
    this.fileType = fileType;
    this.fs = fs;
    this.parsers = parsers;
    this.pathInfo = parseAppPath(this.relativePath);
    this.type = sourceCodeTypeOf(this.uri);
  }

  // ─── Identity ───────────────────────────────────────────────────────────────

  /**
   * The logical name other files refer to this one by — what goes inside
   * `{% render '…' %}`, `{% function … = '…' %}`, `{% graphql … = '…' %}` — and
   * the key {@link App}'s per-type index is built on.
   *
   * It is the path with its type's directory prefix stripped and its extension
   * removed, prefixed with `modules/<name>/` for a module file. Every part of
   * that is derived from `FILE_TYPE_DIRS`; nothing here knows a directory name.
   *
   * @example 'app/views/partials/ui/card.liquid'                  → 'ui/card'
   * @example 'app/lib/commands/create.liquid'                     → 'commands/create'
   * @example 'modules/core/public/views/partials/card.liquid'      → 'modules/core/card'
   * @example 'app/modules/core/public/views/partials/card.liquid'  → 'modules/core/card'
   */
  get name(): string {
    // Delegates to `pathToName`, which `nameToPaths` is the proven inverse of, so a
    // name from the index and a name from a path cannot diverge. Every AppFile is
    // anchored (createAppFile refuses anything else), so this always resolves.
    return pathToName(this.relativePath)!.name;
  }

  /** The module this file belongs to, or `undefined` for an app-level file. */
  get moduleName(): string | undefined {
    return this.pathInfo?.moduleName;
  }

  /** True for a file under `modules/<name>/…`, which an `app/modules/<name>/…` copy can shadow. */
  get isModuleOriginal(): boolean {
    return this.moduleName !== undefined && !this.pathInfo!.isModuleOverwrite;
  }

  /**
   * True for a file under `app/modules/<name>/…`.
   *
   * That is where you overwrite an installed module's file: you copy it to the EXACT
   * same path inside `app/`, and the platform prefers your copy on deploy while both
   * files stay in the repository. It is also where a module internal to the
   * application lives, and the two are indistinguishable from the path alone — so
   * this really means "would shadow a `modules/<name>/…` file of the same name, if
   * one existed". {@link moduleOriginalUri} names the file it would shadow, whether
   * or not that file exists.
   */
  get isModuleOverwrite(): boolean {
    return this.pathInfo?.isModuleOverwrite ?? false;
  }

  /** Where the `modules/<name>/…` original this file overwrites would live. */
  get moduleOriginalUri(): UriString | undefined {
    if (!this.isModuleOverwrite) return undefined;
    return `${this.rootUri}/${this.relativePath.replace(/^app\//, '')}`;
  }

  /** Where an `app/modules/<name>/…` overwrite of this original would live. */
  get moduleOverwriteUri(): UriString | undefined {
    if (!this.isModuleOriginal) return undefined;
    return `${this.rootUri}/app/${this.relativePath}`;
  }

  /**
   * Where this file's directory sits in the candidate list `DocumentsLocator`
   * walks for its type, so that "first candidate that exists wins" becomes a
   * comparison. `undefined` means no candidate path covers it, which is also why
   * the walk would never find it.
   */
  get searchPathIndex(): number | undefined {
    return this.pathInfo?.searchPathIndex;
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
   * Throws when the file has not been loaded. That is deliberate: a silent `''`
   * would turn "nobody awaited `load()`" into wrong lint results — an empty
   * translation table, a partial with no `{% doc %}` — which is far harder to
   * find than a stack trace naming the file.
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
   * The parsed representation of {@link source}, or an `Error` VALUE when the
   * source does not parse. Memoized per version, and never throws for a parse
   * failure — checks report unparseable files, so that is data, not an
   * exception.
   *
   * Returns an `Error` rather than throwing when no parser is registered for
   * this file's type, for the same reason.
   */
  get ast(): unknown {
    if (!this.hasParsed) {
      this.parsed = this.parse(this.source);
      this.hasParsed = true;
    }
    return this.parsed;
  }

  /** Read this file's source into memory. At most one read per version, however many callers await it. */
  async load(): Promise<void> {
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
    this.loadedSourceValue = source;
    this.versionValue = version;
    this.parsed = undefined;
    this.hasParsed = false;
  }

  /**
   * Forget the source and the parse, so the next {@link load} reads from disk
   * again. This is the whole invalidation story for a file that changed
   * underneath us: drop it and let laziness decide whether it is worth re-reading.
   */
  invalidate(): void {
    this.loadedSourceValue = undefined;
    this.versionValue = undefined;
    this.parsed = undefined;
    this.hasParsed = false;
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

/** A Liquid-containing file: pages, layouts, partials, notifications, migrations, forms. */
export class LiquidFile extends AppFile {}

/** A partial or library function — the files `render`, `include` and `function` resolve to. */
export class PartialFile extends LiquidFile {}

/** A page: the platform routes to it, so its frontmatter is what other tooling reads. */
export class PageFile extends LiquidFile {}

/** A layout, referenced by a page's `layout:` frontmatter key. */
export class LayoutFile extends LiquidFile {}

/** A YAML-sourced file: translations, custom model types, profile types, transactable types. */
export class YamlFile extends AppFile {}

/** A translation file, keyed by locale and merged across modules. */
export class TranslationFile extends YamlFile {}

/**
 * `app/config.yml` — the app's configuration flags. One file at a fixed path with no
 * module form, so an app has exactly one.
 */
export class InstanceConfigFile extends YamlFile {}

/** `app/user.yml` — the property schema shared by all users. Fixed path, like the config. */
export class UserSchemaFile extends YamlFile {}

/** A standalone GraphQL query or mutation. */
export class GraphqlFile extends AppFile {}

/**
 * A static asset. Its {@link AppFile.name} keeps the extension, because that is how
 * `{% asset %}` and `{% asset_url %}` spell their references — see
 * `REFERENCE_EXTENSIONS`, which is where that rule lives for both directions.
 */
export class AssetFile extends AppFile {}

/** The concrete {@link AppFile} class each platformOS file type is represented by. */
const FILE_CLASS_BY_TYPE: Readonly<Record<PlatformOSFileType, typeof AppFile>> = {
  [PlatformOSFileType.Page]: PageFile,
  [PlatformOSFileType.Layout]: LayoutFile,
  [PlatformOSFileType.Partial]: PartialFile,
  [PlatformOSFileType.Authorization]: LiquidFile,
  [PlatformOSFileType.Email]: LiquidFile,
  [PlatformOSFileType.ApiCall]: LiquidFile,
  [PlatformOSFileType.Sms]: LiquidFile,
  [PlatformOSFileType.Migration]: LiquidFile,
  [PlatformOSFileType.FormConfiguration]: LiquidFile,
  [PlatformOSFileType.Table]: YamlFile,
  [PlatformOSFileType.UserProfileType]: YamlFile,
  [PlatformOSFileType.TransactableType]: YamlFile,
  [PlatformOSFileType.Translation]: TranslationFile,
  [PlatformOSFileType.ActivityStreamsHandler]: YamlFile,
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: YamlFile,
  [PlatformOSFileType.InstanceConfig]: InstanceConfigFile,
  [PlatformOSFileType.UserSchema]: UserSchemaFile,
  [PlatformOSFileType.GraphQL]: GraphqlFile,
  [PlatformOSFileType.Asset]: AssetFile,
};

/**
 * Build the {@link AppFile} for `uri`, or `undefined` when the URI is not in a
 * recognized platformOS directory and so is not part of the app at all.
 *
 * Classification is ANCHORED under `rootUri`: a file belongs to the app only if it
 * sits at `{app,marketplace_builder}/{dir}/…` or
 * `[app/]modules/<name>/{public,private}/{dir}/…` relative to the root. Matching a
 * known directory ANYWHERE in the path is not enough —
 * `seed/post_import/app/migrations/x.liquid` contains `app/migrations/` but is not in
 * the app, is not deployed, and so is not linted.
 */
export function createAppFile(
  uri: UriString,
  rootUri: UriString,
  fs: AbstractFileSystem,
  parsers: Parsers = {},
): AppFile | undefined {
  const normalizedUri = normalizeUri(uri);
  const fileType = parseAppPath(relativeUriPath(normalizedUri, rootUri))?.fileType;
  if (fileType === undefined) return undefined;

  const FileClass = FILE_CLASS_BY_TYPE[fileType] as new (
    uri: UriString,
    rootUri: UriString,
    fileType: PlatformOSFileType,
    fs: AbstractFileSystem,
    parsers: Parsers,
  ) => AppFile;

  return new FileClass(normalizedUri, rootUri, fileType, fs, parsers);
}
