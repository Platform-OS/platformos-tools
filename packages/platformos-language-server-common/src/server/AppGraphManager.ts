import { path, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import {
  appBackedGetSourceCode,
  buildAppGraph,
  FileSourceCode,
  IDependencies as GraphDependencies,
  Location,
  toSourceCode,
} from '@platformos/platformos-graph';
import { Range } from 'vscode-json-languageservice';
import { Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from '../documents';
import {
  AugmentedLocation,
  AugmentedLocationWithExistence,
  AugmentedReference,
  AppGraphDidUpdateNotification,
} from '../types';
import { debounce } from '../utils';
import { FindAppRootURI } from '../internal-types';

export class AppGraphManager {
  graphs: Map<string, ReturnType<typeof buildAppGraph>> = new Map();
  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private fs: AbstractFileSystem,
    private findAppRootURI: FindAppRootURI,
  ) {}

  async getAppGraphForURI(uri: string) {
    const rootUri = await this.findAppRootURI(uri);
    if (!rootUri) {
      return undefined;
    }

    if (!this.graphs.has(rootUri)) {
      this.graphs.set(
        rootUri,
        // A rejected promise left in the map would replay the same failure for the
        // rest of the session, including after the user has fixed its cause — the
        // build awaits `preload`, which is exactly the kind of failure that gets
        // fixed and retried (an unreadable directory, a `chmod` away).
        this.buildAppGraph(rootUri).catch((error) => {
          this.graphs.delete(rootUri);
          throw error;
        }),
      );
    }

    return this.graphs.get(rootUri);
  }

  async getReferences(uri: string, offset?: number, { includeIndirect = true } = {}) {
    const graph = await this.getAppGraphForURI(uri);
    if (!graph) return [];

    const module = graph.modules[uri];
    if (!module) return [];

    const includedTypes: (AugmentedReference['type'] | undefined)[] = [
      'direct',
      includeIndirect ? 'indirect' : undefined,
    ];

    const refs = module.references.filter((dep) => includedTypes.includes(dep.type));

    return Promise.all(
      refs.map(async (ref) => {
        const [source, target] = await Promise.all([
          this.augmentedLocation(ref.source),
          this.augmentedLocation(ref.target),
        ]);
        return {
          ...ref,
          source: source,
          target: target,
        } as AugmentedReference;
      }),
    );
  }

  async getDependencies(uri: string, offset?: number, { includeIndirect = true } = {}) {
    const graph = await this.getAppGraphForURI(uri);
    if (!graph) return [];

    const module = graph.modules[uri];
    if (!module) return [];

    const includedTypes: (AugmentedReference['type'] | undefined)[] = [
      'direct',
      includeIndirect ? 'indirect' : undefined,
    ];

    const deps = module.dependencies.filter((dep) => includedTypes.includes(dep.type)) ?? [];

    return Promise.all(
      deps.map(async (dep) => {
        const [source, target] = await Promise.all([
          this.augmentedLocation(dep.source),
          this.augmentedLocation(dep.target),
        ]);
        return {
          ...dep,
          source: source,
          target: target,
        } as AugmentedReference;
      }),
    );
  }

  async augmentedLocation(loc: Location): Promise<AugmentedLocation> {
    const sourceCode = await this.getSourceCode(loc.uri).catch(() => undefined);
    const { uri, range } = loc;
    if (!sourceCode || !range)
      return { exists: !!sourceCode, ...loc } as AugmentedLocationWithExistence;

    let doc = this.documentManager.get(loc.uri)?.textDocument;
    if (!doc) {
      doc = TextDocument.create(sourceCode.uri, sourceCode.type, 0, sourceCode.source);
    }

    return {
      uri: uri,
      range: range,
      excerpt: sourceCode.source.slice(range[0], range[1]),
      position: Range.create(doc.positionAt(range[0]), doc.positionAt(range[0])),
      exists: true, // implicit since sourceCode exists
    };
  }

  public operationQueue: string[] = [];

  async rename(oldUri: string, newUri: string) {
    this.operationQueue.push(oldUri);
    this.operationQueue.push(newUri);
    this.processQueue();
  }

  async change(uri: string) {
    this.operationQueue.push(uri);
    this.processQueue();
  }

  async create(uri: string) {
    this.operationQueue.push(uri);
    this.processQueue();
  }

  async delete(uri: string) {
    this.operationQueue.push(uri);
    this.processQueue();
  }

  private processQueue = debounce(async () => {
    const operations = [...new Set(this.operationQueue.splice(0, this.operationQueue.length))];
    if (operations.length === 0) return;

    const anyUri = operations[0];
    const rootUri = await this.findAppRootURI(anyUri);
    if (!rootUri) return;

    // Delete existing graph to force rebuild
    this.graphs.delete(rootUri);
    try {
      await this.getAppGraphForURI(rootUri);
    } catch (error) {
      // Nothing awaits this queue — it is driven by file-watcher events — so an
      // escaping rejection is an unhandled one, which takes the server down. The
      // rebuild failed, so there is no graph to announce; the cause has already
      // been reported by whatever raised it.
      console.error('Failed to rebuild the app graph', error);
      return;
    }
    this.connection.sendNotification(AppGraphDidUpdateNotification.type, { uri: rootUri });
  }, 500);

  /**
   * The graph's entry points, taken from the app rather than rediscovered.
   *
   * `buildAppGraph` walks the project itself when it is given none, and classifies
   * every path it finds — the same walk and the same classification `preload` just
   * did, repeated on the 500 ms debounce after every file event for the life of the
   * session. The `App` is the authoritative answer already: pages and layouts are
   * the entry points because they are what the platform requests directly, and
   * Liquid is the only source that can reference another file.
   */
  private buildAppGraph = async (rootUri: string, entryPoints?: string[]) => {
    const { documentManager } = this;
    await documentManager.preload(rootUri);

    const app = documentManager.appModel(rootUri);
    entryPoints ??= [...app.pages(), ...app.layouts()]
      .filter((file) => file.type === SourceCodeType.LiquidHtml)
      .map((file) => file.uri);

    const dependencies = this.graphDependencies(rootUri);
    const graph = await buildAppGraph(rootUri, dependencies, entryPoints);
    return graph;
  };

  private getSourceCode = async (uri: string): Promise<FileSourceCode> => {
    const doc = this.documentManager.get(uri);
    if (doc) return doc;

    const source = await this.fs.readFile(uri);
    return toSourceCode(uri, source);
  };

  /**
   * The graph reads its files THROUGH the app the language server already holds.
   *
   * Without this the two halves of this process each build their own source code
   * for the same file: the checks parse the `App`'s `AppFile`, the graph parses a
   * copy of it. `appBackedGetSourceCode` hands the graph the very same file
   * objects, so each one is read once and parsed once for both — including the
   * `.js` and image assets, which are in the app as nodes with no `SourceCodeType`
   * and are parsed by the graph's own entries in `languageServerParsers`.
   *
   * The fallback covers what the app does not contain: a URI outside the project,
   * and a file that is not a platformOS source at all.
   */
  private graphDependencies(rootUri: string): GraphDependencies {
    const { fs } = this;
    return {
      fs,
      getSourceCode: appBackedGetSourceCode(
        this.documentManager.appModel(rootUri),
        this.getSourceCode,
      ),
    };
  }
}
