import {
  memo,
  memoize,
  path,
  SourceCodeType,
  sourceParsers,
  toSourceCode,
  UriString,
  IsValidSchema,
  isError,
  LiquidHtmlNode,
  DocDefinition,
} from '@platformos/platformos-check-common';

import {
  AbstractFileSystem,
  App,
  AppFile,
  getFileType,
  Parsers,
  PlatformOSFileType,
  normalizeUri,
  sourceCodeTypeOf,
  UnreadableDirectoryError,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import { graphParsers } from '@platformos/platformos-graph';
import { Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClientCapabilities } from '../ClientCapabilities';
import { FindAppRootURI } from '../internal-types';
import { percent, Progress } from '../progress';
import { AugmentedSourceCode } from './types';
import { extractDocDefinition } from '@platformos/platformos-check-common';

/**
 * The parsers the language server's {@link App}s are built with: check-common's liquid /
 * graphql / yaml plus the graph's `.js` and image extensions. Merging them is what lets
 * ONE set of `AppFile`s serve both the checks and the graph build in this process, so a
 * file is read once and parsed once for both.
 */
export const languageServerParsers: Parsers = {
  ...sourceParsers,
  extensions: { ...graphParsers.extensions },
};

/**
 * An `App` needs a filesystem to read through. A `DocumentManager` built without
 * one holds only what the editor hands it, so nothing it contains is ever read —
 * but a `load()` that slipped through must say so rather than resolve to nothing.
 */
const NO_FILE_SYSTEM: AbstractFileSystem = {
  readFile: async (uri) => {
    throw new Error(`Cannot read ${uri}: this DocumentManager has no FileSystem`);
  },
  readDirectory: async (uri) => {
    throw new Error(`Cannot list ${uri}: this DocumentManager has no FileSystem`);
  },
  stat: async (uri) => {
    throw new Error(`Cannot stat ${uri}: this DocumentManager has no FileSystem`);
  },
};

export class DocumentManager {
  /**
   * The project's files, one {@link App} per root — the same object model the
   * linter and the graph build use, rather than a second, LSP-shaped copy of it.
   *
   * A root is learned as a PARAMETER: this class is handed bare URIs by
   * `open`/`change`/`close`/`rename`, and only `app()` and `preload()` say which
   * project a URI belongs to. So an app is created the first time a root is named,
   * and {@link unrooted} holds whatever the editor opened before that.
   */
  private readonly apps = new Map<UriString, App>();

  /**
   * Editor buffers that belong to no app: a `.liquid` file the user opened from
   * outside any project, or one under a root that the platform does not deploy
   * (`scripts/build.liquid`). The editor still formats, highlights and completes
   * in them, so they are managed — but they are not part of any `App`, which is
   * what keeps them out of diagnostics and out of the graph.
   *
   * Also where a buffer waits when its root has not been named yet; {@link appAt}
   * adopts it the moment one is.
   */
  private readonly unrooted = new Map<UriString, AugmentedSourceCode>();

  /** The failure last shown per root, so a repeating one is logged and not re-notified. */
  private reportedPreloadFailures = new Map<UriString, string>();

  /**
   * The language server's view of each {@link AppFile}, held BESIDE the file.
   *
   * A `WeakMap`, not properties written onto the file: `AppFile` belongs to
   * platformos-common and the checks and the graph hold the same objects, so the LSP's
   * shape must not leak into them. Keyed on the file OBJECT, which also sets the
   * lifetime — `App.update` replaces the object, so a changed file gets a fresh view.
   */
  private readonly views = new WeakMap<AppFile, AugmentedSourceCode>();

  constructor(
    private readonly fs?: AbstractFileSystem,
    private readonly connection?: Connection,
    private readonly clientCapabilities?: ClientCapabilities,
    private readonly isValidSchema?: IsValidSchema,
    private readonly findAppRootURI?: FindAppRootURI,
  ) {}

  /**
   * The platformOS type of the file at `uri` — THE language server's classifier, so
   * "no root" has one spelling: `undefined`.
   *
   * A URI under a KNOWN root costs no async walk: its `AppFile` classified its path at
   * construction, and a URI the app does not hold is classified against that root
   * directly. Only a URI under no root named so far pays the `findAppRootURI` walk.
   */
  public async fileType(uri: UriString): Promise<PlatformOSFileType | undefined> {
    const normalized = path.normalize(uri);

    const app = this.appFor(normalized);
    if (app) return app.get(normalized)?.fileType ?? getFileType(normalized, app.rootUri);

    if (!this.findAppRootURI) return undefined;
    const rootUri = await this.findAppRootURI(normalized).catch(() => null);
    return rootUri ? getFileType(normalized, rootUri) : undefined;
  }

  public open(uri: UriString, source: string, version: number | undefined) {
    return this.set(uri, source, version);
  }

  public change(uri: UriString, source: string, version: number | undefined) {
    return this.set(uri, source, version);
  }

  /**
   * Take the file's contents from disk again, as "what is on disk" rather than an
   * editor buffer.
   *
   * The read is eager rather than an {@link App.invalidate}: every document this
   * class hands out is loaded, and callers read `.source` synchronously the moment
   * this resolves.
   */
  public async changeFromDisk(uri: UriString) {
    if (!this.fs) throw new Error('Cannot call changeFromDisk without a FileSystem');
    this.change(uri, await this.fs.readFile(uri), undefined);
  }

  public close(uri: UriString) {
    const document = this.get(uri);
    if (!document) return;
    return this.set(uri, document.source, undefined);
  }

  public delete(uri: UriString) {
    const normalized = path.normalize(uri);
    const app = this.appFor(normalized);
    if (app?.has(normalized)) {
      app.remove([normalized]);
      return true;
    }
    return this.unrooted.delete(normalized);
  }

  /**
   * The old path is dropped whether or not we hold its contents — it is gone from
   * disk, and an `App` that still lists it would hand the graph a file to read that
   * is not there. The new path only gets an entry if there were contents to carry
   * over; otherwise the walk finds it, the same as any other file on disk.
   */
  public rename(oldUri: UriString, newUri: UriString) {
    const document = this.get(oldUri);
    this.delete(oldUri);
    if (!document) return;
    this.set(newUri, document.source, document.version);
  }

  /**
   * The app's files as the checks see them — `App.sourceCodes()` is the same
   * intersection `isSupportedSourceFile` names (the platform deploys it AND we have a
   * parser for it), asked of a file that classified its own path at construction.
   */
  public app(root: UriString, includeFilesFromDisk = false): AugmentedSourceCode[] {
    return this.appAt(root)
      .sourceCodes()
      .filter(isReadable)
      .filter((file) => includeFilesFromDisk || file.version !== undefined)
      .map((file) => this.augment(file));
  }

  /**
   * The {@link App} backing `root`, for consumers that want the model rather than
   * a list of source codes — `appBackedGetSourceCode`, which is what makes the
   * graph build and a check run share one parse per file.
   */
  public appModel(root: UriString): App {
    return this.appAt(root);
  }

  public get openDocuments(): AugmentedSourceCode[] {
    return this.allDocuments().filter((sourceCode) => sourceCode.version !== undefined);
  }

  public get(uri: UriString): AugmentedSourceCode | undefined {
    const normalized = path.normalize(uri);
    const file = this.appFor(normalized)?.get(normalized);
    if (file && isReadable(file)) return this.augment(file);
    return this.unrooted.get(normalized);
  }

  public has(uri: UriString) {
    return this.get(uri) !== undefined;
  }

  /**
   * Record an editor buffer, in the app it belongs to or in {@link unrooted}.
   *
   * Only a project ROOT can say whether a URI is part of an app, so until some caller
   * has NAMED one — `app()`, `preload()` — the buffer waits to be adopted.
   */
  private set(uri: UriString, source: string, version: number | undefined) {
    uri = path.normalize(uri);
    if (sourceCodeTypeOf(uri) === undefined) return;

    if (this.appFor(uri)?.setSource(uri, source, version)) return;

    this.unrooted.set(uri, this.augmentedSourceCode(uri, source, version));
  }

  /**
   * Load every file in the app, skipping the ones already held. Files read from the
   * `AbstractFileSystem` get a version of `undefined`, which is what "on disk" means.
   *
   * The walk's paths are CLASSIFIED first and read second, and the two sets differ:
   * every file under the app subtrees joins the `App` — assets included, because the
   * graph has nodes for them — while only the ones with a parser are read. Nothing is
   * parsed here at all; an `AppFile` parses on the first `ast`.
   *
   * An UNREADABLE file is skipped and logged — one file the editor cannot open is not a
   * reason to have no language support. An unreadable DIRECTORY fails the whole walk, so
   * there is no file list, and that is surfaced rather than served as an empty workspace.
   */
  public preload = memoize(
    async (rootUri: UriString) => {
      if (!this.fs) throw new Error('Cannot call preload without a FileSystem');
      const { fs, connection, clientCapabilities } = this;
      const app = this.appAt(rootUri);
      const progress = Progress.create(connection, clientCapabilities, `preload#${rootUri}`);

      progress.start('Initializing Liquid LSP');

      try {
        const walked = await walkAppSourceFiles(fs, app.rootUri);
        // Path work only: `update` classifies and indexes, and reads nothing. Files
        // already here keep the source and version they have.
        //
        // Compared as STRINGS: both sides are already in the one normalized spelling,
        // whereas `app.has()` per path re-parses every URI on the server's startup path.
        const known = new Set(app.all().map((file) => file.uri));
        app.update(walked.filter((uri) => !known.has(uri)));

        const filesToLoad = app.sourceCodes().filter((file) => !file.loaded);

        progress.report(10, 'Preloading files');

        let [i, n] = [0, filesToLoad.length];
        await Promise.all(
          filesToLoad.map(async (file) => {
            // The version stays `undefined`, which is what "on disk" means.
            try {
              await file.load();
            } catch (error) {
              console.error('Failed to preload', file.uri, error);
            }

            if (++i % 10 === 0) {
              const message = `Preloading files [${i}/${n}]`;
              progress.report(percent(i, n, 10), message);
            }
          }),
        );
        progress.end('Completed');
        this.reportedPreloadFailures.delete(rootUri);
      } catch (error) {
        // A bare rejection would leave the client's spinner running for the session, and
        // `memoize` would cache the REJECTED promise so every later preload of this root
        // replays the failure even after the user fixes its cause. So: end the progress,
        // drop the memo so a retry is possible, and SAY what happened. Rethrowing is
        // deliberate — awaiting callers asked for a loaded workspace and did not get one.
        progress.end('Failed');
        this.preload.invalidate(rootUri);
        this.reportPreloadFailure(rootUri, error);
        throw error;
      }
    },
    (rootUri) => rootUri,
  );

  /**
   * Preload without making the caller responsible for the failure — the one shape a
   * fire-and-forget preload may take. `preload` reports its own failures, so all that
   * is left is to keep the rejection from escaping: an unhandled one ends the language
   * server process, and one unreadable directory should not cost a project every feature.
   */
  public preloadInBackground(rootUri: UriString): void {
    this.preload(rootUri).catch(() => {});
  }

  /**
   * Tell the user the workspace did not load, and why.
   *
   * An {@link UnreadableDirectoryError} already explains itself — it names the
   * directory relative to the root and says what to do — so it is passed through
   * verbatim. Anything else gets a prefix, because on its own its message would not
   * say what it was that failed.
   *
   * The NOTIFICATION is shown once per distinct failure per root: dropping the memo
   * above means a repeating failure retries on every file event that rebuilds the graph,
   * which would otherwise toast on every save. A preload that succeeds clears the record.
   * The LOG is not deduplicated and carries the error and its stack.
   */
  private reportPreloadFailure(rootUri: UriString, error: unknown) {
    const message =
      error instanceof UnreadableDirectoryError
        ? error.message
        : `Failed to load the platformOS project: ${
            error instanceof Error ? error.message : String(error)
          }`;

    console.error('Failed to preload', rootUri, error);

    if (this.reportedPreloadFailures.get(rootUri) === message) return;
    this.reportedPreloadFailures.set(rootUri, message);
    this.connection?.window.showErrorMessage(message);
  }

  // ─── The App registry ───────────────────────────────────────────────────────

  /**
   * The app rooted at `root`, created on first mention.
   *
   * Keyed by `normalizeUri`, the spelling `App` itself uses for `rootUri`. check-common's
   * `path.normalize` delegates to the same function, so a root reaches this map in one
   * spelling however it was normalized upstream — otherwise `app('…/project/')` and
   * `app('…/project')` build two apps for one project.
   *
   * Creating one adopts every buffer the editor opened before this root had a name.
   */
  private appAt(root: UriString): App {
    const rootUri = normalizeUri(root);
    let app = this.apps.get(rootUri);
    if (app) return app;

    app = App.fromPaths(rootUri, [], this.fs ?? NO_FILE_SYSTEM, languageServerParsers);
    this.apps.set(app.rootUri, app);

    for (const [uri, document] of [...this.unrooted]) {
      if (!isUnder(uri, app.rootUri)) continue;
      if (app.setSource(uri, document.source, document.version)) this.unrooted.delete(uri);
    }

    return app;
  }

  /**
   * The app `uri` belongs to, of the roots named so far — the innermost one, so a
   * project nested inside another workspace folder wins over its container.
   */
  private appFor(uri: UriString): App | undefined {
    let owner: App | undefined;
    for (const app of this.apps.values()) {
      if (!isUnder(uri, app.rootUri)) continue;
      if (!owner || app.rootUri.length > owner.rootUri.length) owner = app;
    }
    return owner;
  }

  private allDocuments(): AugmentedSourceCode[] {
    const fromApps = [...this.apps.values()].flatMap((app) =>
      app
        .sourceCodes()
        .filter(isReadable)
        .map((file) => this.augment(file)),
    );
    return [...fromApps, ...this.unrooted.values()];
  }

  // ─── The language server's view of a file ───────────────────────────────────

  /**
   * The language server's view of an {@link AppFile}: the file's `SourceCode`
   * surface plus `textDocument` (and, for Liquid, `getLiquidDoc`), held in
   * {@link views} BESIDE the file — nothing is ever written onto the file itself.
   *
   * Every forwarded property is a GETTER that delegates — never
   * `{ ...file, textDocument }`. Spreading evaluates getters, so it would read `ast`
   * for every file in the workspace and parse the entire project, silently undoing the
   * laziness. Delegation also keeps the view live, with no copy to go stale.
   *
   * One view per file object rather than per read is what lets the two extras cache;
   * both are keyed on the source they were built from.
   */
  private augment(file: AppFile): AugmentedSourceCode {
    const existing = this.views.get(file);
    if (existing) return existing;

    let textDocument: TextDocument | undefined;
    let documentSource: string | undefined;
    let documentVersion: number | undefined;

    const view = {
      get uri() {
        return file.uri;
      },
      get type() {
        return file.type;
      },
      get version() {
        return file.version;
      },
      get source() {
        return file.source;
      },
      get ast() {
        return file.ast;
      },
      get textDocument() {
        const source = file.source;
        if (!textDocument || documentSource !== source || documentVersion !== file.version) {
          documentSource = source;
          documentVersion = file.version;
          textDocument = TextDocument.create(
            file.uri,
            file.type!,
            file.version ?? 0, // create doesn't let us put undefined here.
            source,
          );
        }
        return textDocument;
      },
    } as Record<string, unknown>;

    if (file.type === SourceCodeType.LiquidHtml) {
      let liquidDoc: { source: string; definition: Promise<DocDefinition | undefined> } | undefined;
      /** Lazy and only computed once per file version */
      view.getLiquidDoc = () => {
        const source = file.source;
        if (!liquidDoc || liquidDoc.source !== source) {
          liquidDoc = {
            source,
            definition: Promise.resolve().then(() => {
              const ast = file.ast;
              if (isError(ast)) return undefined;
              return extractDocDefinition(file.uri, ast as LiquidHtmlNode);
            }),
          };
        }
        return liquidDoc.definition;
      };
    }

    const augmented = view as unknown as AugmentedSourceCode;
    this.views.set(file, augmented);
    return augmented;
  }

  /**
   * The same view, for a buffer that is in no app and therefore has no `AppFile`.
   *
   * Built eagerly, because there is nothing to be lazy on behalf of: this is one
   * document the user has open, not a workspace.
   */
  private augmentedSourceCode(
    uri: UriString,
    source: string,
    version: number | undefined,
  ): AugmentedSourceCode {
    const sourceCode = toSourceCode(uri, source, version);
    const textDocument = TextDocument.create(
      uri,
      sourceCode.type,
      sourceCode.version ?? 0, // create doesn't let us put undefined here.
      sourceCode.source,
    );

    if (sourceCode.type !== SourceCodeType.LiquidHtml) {
      return attach(sourceCode, { textDocument });
    }

    return attach(sourceCode, {
      textDocument,
      /** Lazy and only computed once per file version */
      getLiquidDoc: memo(async () => {
        const ast = sourceCode.ast;
        if (isError(ast)) return undefined;
        return extractDocDefinition(uri, ast as LiquidHtmlNode);
      }),
    });
  }
}

/**
 * Whether an app file is one the language server can hand out as a DOCUMENT: it needs a
 * `SourceCodeType` (an image or `.js` asset is in the app only because the graph has a
 * node for it) and its contents must have been read (`AppFile.source` THROWS rather than
 * pretending to be empty). So a document exists here exactly when its contents do.
 */
function isReadable(file: AppFile): boolean {
  return file.type !== undefined && file.loaded;
}

/** Whether `uri` is `rootUri` itself or sits inside it. */
function isUnder(uri: UriString, rootUri: UriString): boolean {
  return uri === rootUri || uri.startsWith(rootUri.endsWith('/') ? rootUri : `${rootUri}/`);
}

/**
 * Add `extras` to `target` in place and return it, so `target`'s own properties —
 * including any lazy getters — are left exactly as they are. Use this instead of
 * `{ ...target, ...extras }`, which reads every getter to copy its value;
 * `lazy-composition.spec.ts` bans the spread package-wide.
 */
function attach<T extends object, E extends object>(target: T, extras: E): T & E {
  return Object.defineProperties(
    target,
    Object.fromEntries(
      Object.entries(extras).map(([key, value]) => [
        key,
        { value, enumerable: true, configurable: true, writable: true },
      ]),
    ),
  ) as T & E;
}
