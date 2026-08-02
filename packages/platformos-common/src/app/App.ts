import { AbstractFileSystem, UriString } from '../AbstractFileSystem';
import { PlatformOSFileType } from '../path-utils';
import { AppFile, createAppFile } from './AppFile';
import { Parsers, SourceCodeType } from './types';
import { normalizeUri } from './uri';

/**
 * A platformOS app as an object model: which files it contains, what each one
 * is, what name other files call it by — and, only where someone actually asked,
 * their sources and ASTs.
 *
 * This is the single answer to "the project's files, parsed", which the toolchain
 * previously had four of (check-node's `getApp`, the language server's
 * `DocumentManager`, the graph's `toSourceCode`, and a fingerprint cache). Each
 * of those either parsed everything up front or remembered every parse to avoid
 * redoing it; this one does neither, because {@link App.fromPaths} classifies
 * paths and nothing else.
 *
 * Two indexes back it:
 *
 * - by URI, for "what is this file" — every file the app contains, including a
 *   `modules/<name>/…` original that an `app/modules/<name>/…` copy shadows.
 * - by (type, {@link AppFile.name}), for "which file does `{% render 'ui/card' %}`
 *   mean" — an O(1) lookup that replaces walking candidate directories with a
 *   `stat` per candidate, and that resolves module shadowing the same way the walk
 *   does, because both order candidates by `getAppPaths`/`getModulePaths`.
 */
export class App {
  /** The project root every {@link AppFile.relativePath} and {@link AppFile.name} is relative to. */
  readonly rootUri: UriString;

  private readonly fs: AbstractFileSystem;
  private readonly parsers: Parsers;

  /** Every file in the app, by normalized URI. */
  private readonly filesByUri = new Map<UriString, AppFile>();

  /**
   * Every file that answers to a given (type, name), best candidate first.
   *
   * Keeping all candidates rather than only the winner is what makes removal
   * exact: deleting an `app/modules/X` overwrite promotes the `modules/X`
   * original back with no bookkeeping, and deleting the original leaves the
   * overwrite in place.
   */
  private readonly filesByName = new Map<PlatformOSFileType, Map<string, AppFile[]>>();

  private constructor(rootUri: UriString, fs: AbstractFileSystem, parsers: Parsers) {
    this.rootUri = normalizeUri(rootUri);
    this.fs = fs;
    this.parsers = parsers;
  }

  /**
   * Build an app from a list of file URIs. Classifies paths and NOTHING else — no
   * `stat`, no read, no parse — which is what makes this affordable to do per
   * call rather than once per process.
   *
   * URIs that are not in a recognized platformOS directory are not part of the
   * app and are dropped.
   */
  static fromPaths(
    rootUri: UriString,
    uris: readonly UriString[],
    fs: AbstractFileSystem,
    parsers: Parsers = {},
  ): App {
    const app = new App(rootUri, fs, parsers);
    for (const uri of uris) app.put(uri);
    return app;
  }

  /**
   * Build an app from contents that are already in memory — an editor's open
   * documents, a fixture written as `relative path → source`, a project served
   * from something that is not a filesystem.
   *
   * Every file starts loaded, so nothing here reads. `fs` still backs files added
   * later via {@link update}.
   */
  static fromSources(
    rootUri: UriString,
    sources: Readonly<Record<string, string>>,
    fs: AbstractFileSystem,
    parsers: Parsers = {},
  ): App {
    const app = new App(rootUri, fs, parsers);
    for (const [pathOrUri, source] of Object.entries(sources)) {
      const uri = pathOrUri.includes('://') ? pathOrUri : `${app.rootUri}/${pathOrUri}`;
      app.setSource(uri, source);
    }
    return app;
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  /** How many files the app contains. */
  get size(): number {
    return this.filesByUri.size;
  }

  /**
   * Every file in the app, including a module original that an app-level copy
   * shadows — a lint run reports on both, so both are here. Use {@link find} when
   * you want the one file a NAME resolves to.
   */
  all(): AppFile[] {
    return [...this.filesByUri.values()];
  }

  /** Every file whose contents a check can be written against, i.e. with a known {@link SourceCodeType}. */
  sourceCodes(): AppFile[] {
    return this.all().filter((file) => file.type !== undefined);
  }

  /** The file at `uri`, or `undefined`. */
  get(uri: UriString): AppFile | undefined {
    return this.filesByUri.get(normalizeUri(uri));
  }

  has(uri: UriString): boolean {
    return this.filesByUri.has(normalizeUri(uri));
  }

  /**
   * The file a logical `name` resolves to for a given type — the O(1) answer to
   * what `{% render 'ui/card' %}` or `{% graphql … = 'user/find' %}` points at.
   *
   * Resolution order is `getAppPaths`/`getModulePaths` order, which is the order
   * `DocumentsLocator.locate` walks, so this and the walk cannot disagree. That is
   * also where module shadowing comes from: `app/modules/X/…` precedes
   * `modules/X/…` in that list.
   */
  find(type: PlatformOSFileType, name: string): AppFile | undefined {
    return this.filesByName.get(type)?.get(name)?.[0];
  }

  /** Every file of a given platformOS type. */
  ofType(type: PlatformOSFileType): AppFile[] {
    return this.all().filter((file) => file.fileType === type);
  }

  partials(): AppFile[] {
    return this.ofType(PlatformOSFileType.Partial);
  }

  pages(): AppFile[] {
    return this.ofType(PlatformOSFileType.Page);
  }

  layouts(): AppFile[] {
    return this.ofType(PlatformOSFileType.Layout);
  }

  translations(): AppFile[] {
    return this.ofType(PlatformOSFileType.Translation);
  }

  graphqls(): AppFile[] {
    return this.ofType(PlatformOSFileType.GraphQL);
  }

  assets(): AppFile[] {
    return this.ofType(PlatformOSFileType.Asset);
  }

  // ─── Mutation ───────────────────────────────────────────────────────────────

  /**
   * Re-classify and re-index the named URIs, adding the ones the app does not
   * have yet. Only these files are touched: every other file keeps the source it
   * had read and the AST it had parsed.
   *
   * A URI that IS already present is replaced by a fresh file, because this is
   * "the file on disk changed" — its cached read and parse are stale by
   * definition. Use {@link invalidate} when you only want to drop the caches.
   */
  update(uris: readonly UriString[]): void {
    for (const uri of uris) {
      this.drop(normalizeUri(uri));
      this.put(uri);
    }
  }

  /**
   * Forget the named URIs.
   *
   * Removing an `app/modules/X` overwrite promotes the `modules/X` original back
   * into the name index; removing an original while its overwrite is still there
   * leaves the overwrite resolving, unchanged.
   */
  remove(uris: readonly UriString[]): void {
    for (const uri of uris) this.drop(normalizeUri(uri));
  }

  /**
   * Overlay in-memory contents onto a file — an editor buffer, or the file being
   * validated before it is written — adding it to the app when it does not exist
   * on disk yet.
   *
   * Returns the file, or `undefined` when the URI is not in a recognized
   * platformOS directory and so cannot be part of the app.
   */
  setSource(uri: UriString, source: string, version?: number): AppFile | undefined {
    const normalized = normalizeUri(uri);
    const file = this.filesByUri.get(normalized) ?? this.put(normalized);
    file?.setSource(source, version);
    return file;
  }

  /** Drop one file's cached source and parse, so the next read goes back to disk. */
  invalidate(uri: UriString): void {
    this.filesByUri.get(normalizeUri(uri))?.invalidate();
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  /**
   * Read the sources of the named files (or of every file, when no URIs are
   * given) so their `source` and `ast` become readable synchronously.
   *
   * This is the one place a consumer decides how much of the project it is
   * willing to pay for. `check()` awaits it for the files it will visit; a
   * whole-project command awaits it for everything.
   */
  async load(uris?: readonly UriString[]): Promise<void> {
    const files = uris
      ? uris.map((uri) => this.filesByUri.get(normalizeUri(uri))).filter(isPresent)
      : this.all();
    await Promise.all(files.map((file) => file.load()));
  }

  // ─── Indexing ───────────────────────────────────────────────────────────────

  private put(uri: UriString): AppFile | undefined {
    const file = createAppFile(uri, this.rootUri, this.fs, this.parsers);
    if (!file) return undefined;
    this.insert(file);
    return file;
  }

  private insert(file: AppFile): void {
    this.filesByUri.set(file.uri, file);

    let byName = this.filesByName.get(file.fileType);
    if (!byName) {
      byName = new Map();
      this.filesByName.set(file.fileType, byName);
    }

    const candidates = byName.get(file.name) ?? [];
    const existing = candidates.findIndex((candidate) => candidate.uri === file.uri);
    if (existing !== -1) candidates.splice(existing, 1);
    // Insert before the first weaker candidate, so index 0 is always the file the
    // candidate-path walk would have found first, and equal-strength candidates
    // keep insertion order.
    const at = candidates.findIndex((candidate) => rank(candidate) > rank(file));
    candidates.splice(at === -1 ? candidates.length : at, 0, file);
    byName.set(file.name, candidates);
  }

  private drop(uri: UriString): void {
    const file = this.filesByUri.get(uri);
    if (!file) return;
    this.filesByUri.delete(uri);

    const byName = this.filesByName.get(file.fileType);
    const candidates = byName?.get(file.name);
    if (!byName || !candidates) return;

    const remaining = candidates.filter((candidate) => candidate.uri !== uri);
    if (remaining.length === 0) {
      byName.delete(file.name);
    } else {
      byName.set(file.name, remaining);
    }
  }
}

/** Lower ranks resolve first. A file no candidate path covers ranks last. */
function rank(file: AppFile): number {
  return file.searchPathIndex ?? Number.MAX_SAFE_INTEGER;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
