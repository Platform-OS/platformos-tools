import {
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
  Parsers,
  sourceCodeTypeOf,
  UnreadableDirectoryError,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import { graphParsers } from '@platformos/platformos-graph';
import { Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClientCapabilities } from '../ClientCapabilities';
import { percent, Progress } from '../progress';
import { AugmentedSourceCode } from './types';
import { extractDocDefinition } from '@platformos/platformos-check-common';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The parsers the language server's {@link App}s are built with.
 *
 * check-common's `sourceParsers` is the linter's half — liquid, graphql, yaml — and
 * the graph's is `.js` and the image extensions. Merging them is what lets ONE set
 * of `AppFile`s serve both the checks and the graph build in this process, so a
 * file is read once and parsed once for both. See `appBackedGetSourceCode`, which
 * is how `AppGraphManager` consumes them.
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

/** Marks a file the language server has already attached its view to. */
const AUGMENTED = Symbol('augmented');

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

  private recentlyRenamed: Set<UriString>;
  /** The failure last shown per root, so a repeating one is logged and not re-notified. */
  private reportedPreloadFailures = new Map<UriString, string>();

  constructor(
    private readonly fs?: AbstractFileSystem,
    private readonly connection?: Connection,
    private readonly clientCapabilities?: ClientCapabilities,
    private readonly isValidSchema?: IsValidSchema,
  ) {
    this.recentlyRenamed = new Set();
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
    this.trackRename(oldUri, newUri);
    const document = this.get(oldUri);
    this.delete(oldUri);
    if (!document) return;
    this.set(newUri, document.source, document.version);
  }

  /**
   * The app's files as the checks see them.
   *
   * `App.sourceCodes()` is the same intersection `isSupportedSourceFile` names —
   * the platform deploys it (it is in the app at all) AND we have a parser for it
   * (it has a `SourceCodeType`) — asked of a file that classified its own path
   * once at construction, instead of re-deriving it per call per predicate.
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

  /** Used to prevent cache busting twice for the same operation */
  public hasRecentRename(uri: UriString) {
    return this.recentlyRenamed.has(uri);
  }

  public clearRecentRename(uri: UriString) {
    this.recentlyRenamed.delete(uri);
  }

  /**
   * Record an editor buffer.
   *
   * Two questions get asked, and the answer to the second is what decides where
   * the buffer goes:
   *
   * 1. **Can we parse it?** `sourceCodeTypeOf` answers from the URI alone. No —
   *    and there is no document to make.
   * 2. **Is it part of an app?** Only a project ROOT can answer that, because a
   *    platformOS file is one whose position relative to the root matches the
   *    directory structure. The app the URI falls under supplies the root, so this
   *    asks the question exactly the way `App`, the checks and the graph do, and
   *    the answer is the same one. Until some caller has NAMED a root — `app()`,
   *    `preload()` — there is nothing to ask it of, and the buffer waits in
   *    {@link unrooted} to be adopted.
   */
  private set(uri: UriString, source: string, version: number | undefined) {
    uri = path.normalize(uri);
    if (sourceCodeTypeOf(uri) === undefined) return;

    if (this.appFor(uri)?.setSource(uri, source, version)) return;

    this.unrooted.set(uri, this.augmentedSourceCode(uri, source, version));
  }

  /**
   * The preload method is used to pre-load all the files in the app. It is smart
   * and only will load files that are not already in the DocumentManager.
   *
   * Files that are loaded from the AbstractFileSystem will have a version of `undefined`.
   *
   * The walk's paths are CLASSIFIED first and read second, and the two sets differ:
   * every file under the app subtrees joins the `App` — assets included, because the
   * graph has nodes for them — while only the ones with a parser are read. Parsing
   * is not part of this at all: an `AppFile` parses on the first `ast`, so opening a
   * workspace no longer pays for the AST of every file in it, and a file nobody looks
   * at costs a read.
   *
   * An UNREADABLE file is skipped and logged — one file the editor cannot open is
   * not a reason to have no language support. An unreadable DIRECTORY is different:
   * the walk that finds the files fails as a whole, so there is no file list at all,
   * and that failure is surfaced rather than served as an empty workspace.
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
        // already here keep the source (and version) they have — no need to re-read
        // a file we already hold.
        app.update(walked.filter((uri) => !app.has(uri)));

        const filesToLoad = app.sourceCodes().filter((file) => !file.loaded);

        progress.report(10, 'Preloading files');

        let [i, n] = [0, filesToLoad.length];
        await Promise.all(
          filesToLoad.map(async (file) => {
            // This is what is important, we are loading the file from the file system.
            // Its version stays `undefined`, which is what "on disk" means.
            try {
              await file.load();
            } catch (error) {
              console.error('Failed to preload', file.uri, error);
            }

            // This is just doing progress reporting
            if (++i % 10 === 0) {
              const message = `Preloading files [${i}/${n}]`;
              progress.report(percent(i, n, 10), message);
            }
          }),
        );
        progress.end('Completed');
        this.reportedPreloadFailures.delete(rootUri);
      } catch (error) {
        // Three things go wrong if this simply rejects, and none of them look like
        // an error to the user:
        //
        // - the progress token is never ended, so the client's "Initializing Liquid
        //   LSP" spinner runs for the rest of the session;
        // - `memoize` caches the REJECTED promise, so every later preload of this
        //   root — the graph build, every rename — replays the failure, including
        //   after the user has fixed its cause;
        // - the one fire-and-forget caller turns it into an unhandled rejection.
        //
        // So: end the progress, drop the memo so a retry is possible, and SAY what
        // happened. Rethrowing is deliberate — awaiting callers asked for a loaded
        // workspace and did not get one.
        progress.end('Failed');
        this.preload.invalidate(rootUri);
        this.reportPreloadFailure(rootUri, error);
        throw error;
      }
    },
    (rootUri) => rootUri,
  );

  /**
   * Preload without making the caller responsible for the failure.
   *
   * The one shape a fire-and-forget preload may take. `preload` always reports its
   * own failures — a notification for the user, the error and its stack in the
   * server log — so there is nothing left for a background caller to do except NOT
   * let the rejection escape, which is what this is. An unhandled rejection ends the
   * language server process, and one unreadable directory should not cost a project
   * every feature it has.
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
   * The NOTIFICATION is shown once per distinct failure per root, because dropping
   * the memo above means a repeating failure is retried on every file event that
   * rebuilds the graph — without this, an unreadable directory would put a toast on
   * screen every time the user saves. A preload that succeeds clears the record, so
   * a failure that comes back after being fixed is reported again. The LOG is not
   * deduplicated and carries the error itself, stack included: it is the server's
   * output channel, which is where this gets diagnosed.
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
   * Creating one adopts every buffer the editor opened before this root had a
   * name — the `didOpen` that arrives before anything has asked which project the
   * file is in.
   */
  private appAt(root: UriString): App {
    const rootUri = path.normalize(root);
    let app = this.apps.get(rootUri);
    if (app) return app;

    app = App.fromPaths(rootUri, [], this.fs ?? NO_FILE_SYSTEM, languageServerParsers);
    this.apps.set(rootUri, app);

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
   * The language server's view of an {@link AppFile}: the file itself, with
   * `textDocument` (and, for Liquid, `getLiquidDoc`) DEFINED ON IT.
   *
   * Defined, deliberately — never `{ ...file, textDocument }`. Spreading evaluates
   * getters, so a spread here reads `ast` for every file the workspace contains, and
   * an `AppFile`'s whole point is that `ast` parses on first read: the copy would
   * parse the entire project and the laziness would vanish with no visible symptom.
   *
   * Attaching once per file object rather than per read is what lets the two extras
   * cache. Both are keyed on the source they were built from, so an edit — which
   * replaces `source` and drops the parse — rebuilds them, and nothing else does.
   */
  private augment(file: AppFile): AugmentedSourceCode {
    if (AUGMENTED in file) return file as unknown as AugmentedSourceCode;

    let textDocument: TextDocument | undefined;
    let documentSource: string | undefined;
    let documentVersion: number | undefined;

    const extras: PropertyDescriptorMap = {
      [AUGMENTED]: { value: true },
      textDocument: {
        enumerable: true,
        configurable: true,
        get() {
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
      },
    };

    if (file.type === SourceCodeType.LiquidHtml) {
      let liquidDoc: { source: string; definition: Promise<DocDefinition | undefined> } | undefined;
      extras.getLiquidDoc = {
        enumerable: true,
        configurable: true,
        /** Lazy and only computed once per file version */
        value: () => {
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
        },
      };
    }

    return Object.defineProperties(file, extras) as unknown as AugmentedSourceCode;
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
      getLiquidDoc: memoLiquidDoc(uri, sourceCode),
    });
  }

  /**
   * The workspace/onDidRenameFile notification is sent when a file is renamed in the workspace (via a user gesture)
   * The workspace/onDidChangeWatchedFiles notification is sent when a file is renamed on disk (via a file system event)
   *
   * The order is not guaranteed, but it seems to be true that onDidRenameFile happens before onDidChangeWatchedFiles.
   *
   * In the off-chance that the order is reversed, we'll have the sleep timer to clean up the state.
   */
  private trackRename(oldUri: UriString, newUri: UriString) {
    this.recentlyRenamed.add(oldUri);
    this.recentlyRenamed.add(newUri);
    sleep(2000).then(() => {
      this.clearRecentRename(oldUri);
      this.clearRecentRename(newUri);
    });
  }
}

/**
 * Whether an app file is one the language server can hand out as a DOCUMENT.
 *
 * Two ways it is not. A file with no `SourceCodeType` — an image, a `.js` asset —
 * is in the app because the graph has a node for it, and nothing else here can read
 * it. And a file that has not been read yet has no `source`: `App.update` classifies
 * every path the walk found before `preload` reads any of them, and `AppFile.source`
 * THROWS rather than pretending to be empty. So a document exists here exactly when
 * its contents do, which is the same set the old `Map<uri, SourceCode>` held — it
 * only ever got an entry after the read returned.
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
 * including any lazy getters — are left exactly as they are.
 *
 * This is the composition that replaces `{ ...target, ...extras }`. A spread reads
 * every getter on `target` to copy its value; this defines new properties beside
 * them and touches none.
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

function memoLiquidDoc(uri: UriString, sourceCode: { ast: unknown }) {
  let definition: Promise<DocDefinition | undefined> | undefined;
  return () => {
    definition ??= Promise.resolve().then(() => {
      const ast = sourceCode.ast;
      if (isError(ast)) return undefined;
      return extractDocDefinition(uri, ast as LiquidHtmlNode);
    });
    return definition;
  };
}
