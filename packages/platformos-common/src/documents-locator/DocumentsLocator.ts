import yaml from 'js-yaml';
import { AbstractFileSystem, FileType, UriString } from '../AbstractFileSystem';
import { App, normalizeUri } from '../app';
import {
  getAppPaths,
  getFixedFilePath,
  getModulePaths,
  getReferenceExtensions,
  nameToCreationPath,
  parseModulePrefix,
  PlatformOSFileType,
} from '../path-utils';
import { PLATFORM_YAML_LOAD_OPTIONS } from '../yaml-load-options';
import { URI, Utils } from 'vscode-uri';

export type DocumentType =
  | 'function'
  | 'render'
  | 'include'
  | 'background'
  | 'graphql'
  | 'asset'
  | 'layout'
  | 'theme_render_rc';

/**
 * Which platformOS file type each reference kind resolves to — the ONE place the
 * relation is written down.
 *
 * `Record<DocumentType, …>`, so adding a member to {@link DocumentType} without saying
 * what it resolves to is a compile error rather than a silent `undefined` at runtime.
 * That is the whole reason this is a table and not a `switch`: a `switch` can be
 * exhaustive OR have a runtime fallback, and this needs both — see {@link
 * DocumentsLocator.locate}.
 *
 * `layout` is here because the graph resolves a page's frontmatter `layout:` to a node
 * (`graph/traverse.ts`) and `MissingContentForLayout` asks the same question. It needs no
 * extension list of its own: `App.findOrLocate` resolves a layout through the same
 * response-format machinery as everything else, so the legacy `application.html.liquid`
 * spelling is found under the name `application` — verified on a real project — while a
 * name with no file behind it still comes back unresolved.
 *
 * The four partial-valued entries are not redundant: `render`, `include`, `background`,
 * `function` and `theme_render_rc` are five different TAGS that all name a Partial, and
 * they diverge elsewhere — `function` is created in `app/lib` rather than
 * `app/views/partials` ({@link DocumentsLocator.locateDefault}), and `theme_render_rc`
 * resolves through the theme search paths.
 */
const FILE_TYPE_BY_DOCUMENT_TYPE: Readonly<Record<DocumentType, PlatformOSFileType>> = {
  render: PlatformOSFileType.Partial,
  include: PlatformOSFileType.Partial,
  background: PlatformOSFileType.Partial,
  function: PlatformOSFileType.Partial,
  theme_render_rc: PlatformOSFileType.Partial,
  graphql: PlatformOSFileType.GraphQL,
  asset: PlatformOSFileType.Asset,
  layout: PlatformOSFileType.Layout,
};

/**
 * Whether `nodeName` is a reference kind this class knows how to resolve.
 *
 * Needed because the type is not a guarantee at runtime: `DocumentLinksProvider` visits
 * EVERY `LiquidTag` and does `node.name as DocumentType`, so an `{% if %}` or a
 * third-party tag reaches `locate` whenever its markup happens to carry a `partial`
 * field. An unknown name must come back unresolved — a document link that does not
 * resolve — rather than throw inside an LSP request handler.
 */
function isDocumentType(nodeName: string | undefined): nodeName is DocumentType {
  return nodeName !== undefined && nodeName in FILE_TYPE_BY_DOCUMENT_TYPE;
}

/**
 * Where a file of each kind WOULD be created — a different question from where one is
 * looked up, which is why this is a second table rather than a column of the first.
 *
 * `dirIndex` selects among a type's directory aliases in `FILE_TYPE_DIRS`, which is how
 * `function` lands in `app/lib` while `render` lands in `app/views/partials` — expressed
 * as an index rather than as a path spelled here.
 *
 * `layout`'s canonical path uses the modern `.liquid`, not the legacy `.html.liquid`:
 * `REFERENCE_EXTENSIONS[Layout]` is `['.liquid']`, so `nameToCreationPath` produces it
 * without this table naming an extension.
 *
 * `asset` is a real entry and NOT `null`. There is no "creation" path for an asset, but
 * there IS a canonical location and the graph needs it — `graph/traverse.ts` calls
 * `locateOrDefault(…, 'asset', …)` so a reference to a missing asset still yields a node
 * to hang the broken edge on; `undefined` would silently drop those edges. Nothing is
 * appended to the name because an asset reference carries its own extension
 * (`logo.png`), which falls out of `Asset` having no `REFERENCE_EXTENSIONS` row.
 *
 * `theme_render_rc` is `null`: several search-path prefixes are in play, so there is no
 * single canonical location.
 */
const CREATION_TARGET_BY_DOCUMENT_TYPE: Readonly<
  Record<DocumentType, { fileType: PlatformOSFileType; dirIndex: number } | null>
> = {
  render: { fileType: PlatformOSFileType.Partial, dirIndex: 0 },
  include: { fileType: PlatformOSFileType.Partial, dirIndex: 0 },
  background: { fileType: PlatformOSFileType.Partial, dirIndex: 0 },
  function: { fileType: PlatformOSFileType.Partial, dirIndex: 1 },
  graphql: { fileType: PlatformOSFileType.GraphQL, dirIndex: 0 },
  layout: { fileType: PlatformOSFileType.Layout, dirIndex: 0 },
  asset: { fileType: PlatformOSFileType.Asset, dirIndex: 0 },
  theme_render_rc: null,
};

/**
 * Load theme_search_paths from app/config.yml.
 * Returns null if the file doesn't exist, is malformed, or has no valid theme_search_paths.
 * Results should be cached per root URI.
 */
export async function loadSearchPaths(
  fs: { readFile(uri: string): Promise<string> },
  rootUri: URI,
): Promise<string[] | null> {
  try {
    // Where the config file lives is this package's own knowledge; spelling the path
    // here would be a second copy of it inside the package that defines it.
    const configUri = Utils.joinPath(
      rootUri,
      getFixedFilePath(PlatformOSFileType.InstanceConfig)!,
    ).toString();
    const content = await fs.readFile(configUri);
    // A duplicated key must not cost the project its search paths — see
    // PLATFORM_YAML_LOAD_OPTIONS. The `catch` below would otherwise answer "no
    // config", silently sending every lookup down the default paths.
    const config = yaml.load(content, PLATFORM_YAML_LOAD_OPTIONS) as Record<string, unknown> | null;
    const paths = config?.theme_search_paths;
    if (Array.isArray(paths) && paths.length > 0) {
      return paths.map(String);
    }
    return null;
  } catch {
    return null;
  }
}

/** Maximum number of concrete paths generated by a single dynamic search-path expansion. */
const MAX_DYNAMIC_PATH_EXPANSIONS = 100;

/** Resolves the {@link App} whose index should answer for a given project root. */
export type AppResolver = (rootUri: UriString) => App | undefined;

export class DocumentsLocator {
  /**
   * Walk-only apps for roots no {@link App} was supplied for, one per root.
   * `App.fromPaths` with no paths costs nothing and holds nothing; what it
   * provides is `findOrLocate`'s filesystem miss path, so that a caller with no
   * app still resolves through the same single implementation of the rule.
   */
  private readonly fallbackApps = new Map<UriString, App>();

  /**
   * @param fs reads candidate directories when the {@link App}'s index has no
   *   answer, and backs `list` / dynamic search-path expansion.
   * @param app the app (or, for a caller serving several roots, a per-root
   *   resolver) whose index answers first — O(1) and no I/O. Without one, every
   *   resolution takes the filesystem path.
   */
  constructor(
    private readonly fs: AbstractFileSystem,
    private readonly app?: App | AppResolver,
  ) {}

  private getSearchPaths(type: DocumentType, moduleName?: string): string[] {
    const fileType = FILE_TYPE_BY_DOCUMENT_TYPE[type];

    return moduleName ? getModulePaths(fileType, moduleName) : getAppPaths(fileType);
  }

  /**
   * Resolve `fileName` to a concrete URI.
   *
   * The resolution rule itself — index first, filesystem for a name the index
   * cannot answer, assets always from the filesystem — lives in
   * `App.findOrLocate`, in one place for every caller. This class only maps the
   * reference kind to a file type and the root to an app: the one supplied at
   * construction, or a walk-only stand-in when none was.
   *
   * The per-type extension table this used to carry is GONE, deliberately. It listed
   * `['.html.liquid', '.liquid']` for a layout and `['.liquid']` for a partial, and probed
   * each spelling with a `stat` per search path — so it covered exactly the response
   * formats someone had thought to enumerate, and `index.csv.liquid` was not one of them
   * (a measured `MissingPartial` false positive). `findOrLocate` matches directory ENTRY
   * NAMES instead, which covers every format at the I/O cost of covering one, and answers
   * from the O(1) index before touching the filesystem at all.
   */
  private async locateFile(
    rootUri: URI,
    fileName: string,
    type: DocumentType,
  ): Promise<string | undefined> {
    return this.appFor(rootUri).findOrLocate(FILE_TYPE_BY_DOCUMENT_TYPE[type], fileName);
  }

  private appFor(rootUri: URI): App {
    if (typeof this.app === 'function') {
      const provided = this.app(rootUri.toString());
      if (provided) return provided;
    } else if (this.app) {
      return this.app;
    }

    const key = normalizeUri(rootUri.toString());
    let fallback = this.fallbackApps.get(key);
    if (!fallback) {
      fallback = App.fromPaths(key, [], this.fs);
      this.fallbackApps.set(key, fallback);
    }
    return fallback;
  }

  private async listFiles(rootUri: URI, filePrefix: string, type: DocumentType): Promise<string[]> {
    const parsed = parseModulePrefix(filePrefix);
    const searchPaths = this.getSearchPaths(type, parsed.isModule ? parsed.moduleName : undefined);

    const results = new Set<string>();

    // From `REFERENCE_EXTENSIONS` rather than a switch spelling `.liquid`/`.graphql`
    // here: that table already says what extension each type resolves with, and an
    // empty list means "no extension filter" — which is exactly Asset, whose references
    // carry their own extension.
    const extensions = getReferenceExtensions(FILE_TYPE_BY_DOCUMENT_TYPE[type]);
    const matchesType = (name: string): boolean =>
      extensions.length === 0 || extensions.some((extension) => name.endsWith(extension));

    const walk = async (basePath: string, dirUri: URI): Promise<void> => {
      let entries: [string, FileType][];
      try {
        entries = await this.fs.readDirectory(dirUri.toString());
      } catch {
        return;
      }

      for (const [name, fileType] of entries) {
        if (fileType === FileType.Directory) {
          await walk(basePath, URI.parse(name));
          continue;
        }

        if (fileType !== FileType.File) continue;
        if (!matchesType(name)) continue;

        const parsedName = name.slice(basePath.length);
        if (!parsedName.startsWith('/' + parsed.key)) continue;
        let result = parsedName.slice(parsed.key.length);

        if ((parsed.key.endsWith('/') || parsed.key === '') && result.startsWith('/'))
          result = result.slice(1);

        // Same condition as the filter above, from the same table: a type that resolves
        // WITH an extension is referenced without one, so the completion drops it. An
        // asset has no extension of its own to drop.
        if (extensions.length > 0) {
          const index = result.lastIndexOf('.');
          result = index === -1 ? result : result.slice(0, index);
        }
        results.add(result);
      }
    };

    for (const basePath of searchPaths) {
      const baseUri = Utils.joinPath(rootUri, basePath);
      await walk(baseUri.toString(), baseUri);
    }

    return Array.from(results).sort((a, b) => a.localeCompare(b));
  }

  private static readonly LIQUID_EXPRESSION_RE = /\{\{.*?\}\}/;

  private async listSubdirectoryNames(dirUri: string): Promise<string[]> {
    try {
      const entries = await this.fs.readDirectory(dirUri);
      return entries
        .filter(([, type]) => type === FileType.Directory)
        .map(([name]) => {
          const lastSlash = name.lastIndexOf('/');
          return lastSlash === -1 ? name : name.slice(lastSlash + 1);
        })
        .filter((name) => name.length > 0);
    } catch {
      return [];
    }
  }

  private expandedPathsCache = new Map<string, Promise<string[]>>();

  clearExpandedPathsCache(): void {
    this.expandedPathsCache.clear();
  }

  /**
   * Expand a search path that may contain {{ ... }} Liquid expressions into
   * concrete directory prefixes by enumerating subdirectories at each dynamic
   * segment. Static segments pass through unchanged.
   *
   * Results are cached per (rootUri, searchPath) and capped at
   * MAX_DYNAMIC_PATH_EXPANSIONS entries per dynamic segment.
   */
  private async expandDynamicPath(rootUri: URI, searchPath: string): Promise<string[]> {
    const segments = searchPath.split('/');
    // The theme search paths are prefixes onto the PARTIAL directories, which is what
    // `theme_render_rc` resolves against.
    const basePaths = this.getSearchPaths('theme_render_rc');
    let prefixes = [''];

    for (const segment of segments) {
      if (!DocumentsLocator.LIQUID_EXPRESSION_RE.test(segment)) {
        prefixes = prefixes.map((p) => (p ? `${p}/${segment}` : segment));
        continue;
      }

      const nextPrefixes: string[] = [];
      for (const prefix of prefixes) {
        const subdirs = new Set<string>();
        for (const base of basePaths) {
          const dirUri = prefix
            ? Utils.joinPath(rootUri, base, prefix).toString()
            : Utils.joinPath(rootUri, base).toString();
          for (const name of await this.listSubdirectoryNames(dirUri)) {
            subdirs.add(name);
          }
        }
        for (const sub of subdirs) {
          nextPrefixes.push(prefix ? `${prefix}/${sub}` : sub);
          if (nextPrefixes.length >= MAX_DYNAMIC_PATH_EXPANSIONS) break;
        }
        if (nextPrefixes.length >= MAX_DYNAMIC_PATH_EXPANSIONS) break;
      }
      prefixes = nextPrefixes;
    }

    return prefixes;
  }

  /**
   * Resolve a search path (static, dynamic, or empty) into concrete prefix
   * strings. Cached for dynamic paths.
   */
  private async resolveSearchPath(rootUri: URI, searchPath: string): Promise<string[]> {
    if (searchPath === '') return [''];
    if (!DocumentsLocator.LIQUID_EXPRESSION_RE.test(searchPath)) return [searchPath];

    const cacheKey = `${rootUri.toString()}:${searchPath}`;
    if (!this.expandedPathsCache.has(cacheKey)) {
      this.expandedPathsCache.set(cacheKey, this.expandDynamicPath(rootUri, searchPath));
    }
    return this.expandedPathsCache.get(cacheKey)!;
  }

  /**
   * Locate a partial using theme search paths (for theme_render_rc).
   *
   * Tries each search path prefix in priority order, then falls back to the
   * unprefixed name (unless '' was already in the list, meaning the default
   * position was explicitly placed).
   */
  async locateWithSearchPaths(
    rootUri: URI,
    fileName: string,
    themeSearchPaths: string[],
  ): Promise<string | undefined> {
    for (const searchPath of themeSearchPaths) {
      for (const prefix of await this.resolveSearchPath(rootUri, searchPath)) {
        const candidate = prefix ? `${prefix}/${fileName}` : fileName;
        const result = await this.locateFile(rootUri, candidate, 'theme_render_rc');
        if (result) return result;
      }
    }

    if (!themeSearchPaths.includes('')) {
      return this.locateFile(rootUri, fileName, 'theme_render_rc');
    }

    return undefined;
  }

  /**
   * Returns the canonical URI where `fileName` would live — used as a
   * go-to-definition fallback when the file doesn't exist yet.
   * Returns undefined for theme_render_rc (ambiguous search path) and asset.
   */
  locateDefault(rootUri: URI, nodeName: DocumentType, fileName: string): string | undefined {
    const target = CREATION_TARGET_BY_DOCUMENT_TYPE[nodeName];
    // Covers both an unknown name (see `locate`) and `theme_render_rc`, whose entry is
    // `null` — with several search-path prefixes in play there is no single location a
    // new file would belong in.
    if (!target) return undefined;

    return this.creationUri(rootUri, target.fileType, fileName, target.dirIndex);
  }

  private creationUri(
    rootUri: URI,
    fileType: PlatformOSFileType,
    fileName: string,
    dirIndex: number,
  ): string | undefined {
    const path = nameToCreationPath(fileType, fileName, dirIndex);
    return path ? Utils.joinPath(rootUri, path).toString() : undefined;
  }

  /**
   * Resolves `fileName` to a filesystem URI (if the file exists), or falls
   * back to the canonical default URI from `locateDefault`.
   */
  async locateOrDefault(
    rootUri: URI,
    nodeName: DocumentType,
    fileName: string,
    themeSearchPaths?: string[] | null,
  ): Promise<string | undefined> {
    return (
      (await this.locate(rootUri, nodeName, fileName, themeSearchPaths)) ??
      this.locateDefault(rootUri, nodeName, fileName)
    );
  }

  /**
   * The two switches this replaced were exhaustive over {@link DocumentType} AND carried
   * a `default` — which reads as dead code and is not. The type is not a runtime
   * guarantee: `DocumentLinksProvider` casts every visited `LiquidTag`'s name to
   * `DocumentType`, so an unrecognized tag arrives here whenever its markup happens to
   * have a `partial` field. Hence {@link isDocumentType}, a real check, instead of a
   * `default` arm that looks unreachable — and instead of `assertNever`, which would
   * turn a broken document link into a thrown error inside an LSP request.
   *
   * Exhaustiveness has not been given up for that: it moved to
   * {@link FILE_TYPE_BY_DOCUMENT_TYPE}, a `Record<DocumentType, …>` that fails to
   * compile when a member is added without an entry.
   */
  async locate(
    rootUri: URI,
    nodeName: DocumentType,
    fileName: string,
    themeSearchPaths?: string[] | null,
  ): Promise<string | undefined> {
    if (!isDocumentType(nodeName)) return undefined;

    // The one kind whose resolution is not just its file type: a `theme_render_rc`
    // reference is looked up through the configured search-path prefixes first, and only
    // falls back to a plain partial lookup when the project configures none.
    if (nodeName === 'theme_render_rc' && themeSearchPaths) {
      return this.locateWithSearchPaths(rootUri, fileName, themeSearchPaths);
    }

    return this.locateFile(rootUri, fileName, nodeName);
  }

  /** `nodeName` is a bare `string` here by design — completions ask about whatever tag the cursor is in. */
  async list(rootUri: URI, nodeName: string | undefined, filePrefix: string): Promise<string[]> {
    if (!isDocumentType(nodeName)) return [];
    // A layout is never completed: `layout:` is frontmatter, not a tag with a cursor in
    // it, so no completion request names it. Listing them would be harmless but untested.
    if (nodeName === 'layout') return [];

    return this.listFiles(rootUri, filePrefix, nodeName);
  }
}
