import { path, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import {
  buildAppGraph,
  getWebComponentMap,
  IDependencies as GraphDependencies,
  Location,
  toSourceCode,
  WebComponentMap,
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
      this.graphs.set(rootUri, this.buildAppGraph(rootUri));
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

    const graph = await this.graphs.get(rootUri);
    if (!graph) return;

    this.graphs.delete(rootUri);
    await this.getAppGraphForURI(rootUri);
    this.connection.sendNotification(AppGraphDidUpdateNotification.type, { uri: rootUri });
  }, 500);

  private buildAppGraph = async (rootUri: string, entryPoints?: string[]) => {
    const { documentManager } = this;
    await documentManager.preload(rootUri);

    const dependencies = await this.graphDependencies(rootUri);
    return buildAppGraph(rootUri, dependencies, entryPoints);
  };

  private getSourceCode = async (uri: string) => {
    const doc = this.documentManager.get(uri);
    if (doc) return doc;

    const source = await this.fs.readFile(uri);
    return toSourceCode(uri, source);
  };

  private getWebComponentMap(rootUri: string): Promise<WebComponentMap> {
    const { fs, getSourceCode } = this;
    return getWebComponentMap(rootUri, { fs, getSourceCode });
  }

  private async graphDependencies(rootUri: string): Promise<GraphDependencies> {
    const { fs, getSourceCode } = this;
    const webComponentDefs = await this.getWebComponentMap(rootUri);
    return {
      fs: fs,
      getSourceCode: getSourceCode,
      getWebComponentDefinitionReference(customElementName: string) {
        return webComponentDefs.get(customElementName);
      },
    };
  }
}
