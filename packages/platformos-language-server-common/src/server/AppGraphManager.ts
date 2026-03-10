import { path, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import {
  AppGraph,
  buildAppGraph,
  getWebComponentMap,
  IDependencies as GraphDependencies,
  Location,
  toSourceCode,
  WebComponentMap,
} from '@platformos/platformos-graph';
import { Range } from 'vscode-json-languageservice';
import { Connection, DiagnosticSeverity, PublishDiagnosticsNotification } from 'vscode-languageserver';
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
  private cycleAffectedUris: Set<string> = new Set();

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

    // Delete existing graph to force rebuild
    this.graphs.delete(rootUri);
    await this.getAppGraphForURI(rootUri);
    this.connection.sendNotification(AppGraphDidUpdateNotification.type, { uri: rootUri });
  }, 500);

  /**
   * Detect cycles in the dependency graph using iterative DFS.
   * Returns arrays of URIs forming cycles.
   */
  private detectCycles(graph: AppGraph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    // Build adjacency map: uri -> direct dependency uris
    const adjacency = new Map<string, string[]>();
    for (const [uri, module] of Object.entries(graph.modules)) {
      const directDeps = module.dependencies
        .filter((dep) => dep.type === 'direct')
        .map((dep) => dep.target.uri);
      adjacency.set(uri, directDeps);
    }

    const dfs = (uri: string, stack: string[]): void => {
      if (inStack.has(uri)) {
        // Found a cycle — extract the cycle portion
        const cycleStart = stack.indexOf(uri);
        cycles.push([...stack.slice(cycleStart), uri]);
        return;
      }
      if (visited.has(uri)) return;

      inStack.add(uri);
      stack.push(uri);

      const deps = adjacency.get(uri) ?? [];
      for (const depUri of deps) {
        dfs(depUri, stack);
      }

      stack.pop();
      inStack.delete(uri);
      visited.add(uri);
    };

    for (const uri of adjacency.keys()) {
      if (!visited.has(uri)) {
        dfs(uri, []);
      }
    }

    return cycles;
  }

  /**
   * Run cycle detection and publish diagnostics for all affected URIs.
   * Clears diagnostics for previously affected URIs when cycles no longer exist.
   */
  private detectAndPublishCycles(graph: AppGraph): void {
    const cycles = this.detectCycles(graph);
    const newlyAffectedUris = new Set<string>();

    if (cycles.length > 0) {
      // Group cycles by which URIs are involved
      const cyclesByUri = new Map<string, string[][]>();
      for (const cycle of cycles) {
        // All URIs in the cycle (excluding the trailing duplicate) are affected
        const cycleUris = cycle.slice(0, -1);
        for (const uri of cycleUris) {
          newlyAffectedUris.add(uri);
          if (!cyclesByUri.has(uri)) {
            cyclesByUri.set(uri, []);
          }
          cyclesByUri.get(uri)!.push(cycle);
        }
      }

      // Publish diagnostics for all affected URIs
      for (const [uri, uriCycles] of cyclesByUri.entries()) {
        const diagnostics = uriCycles.map((cycle) => {
          const cycleDescription = cycle
            .map((u) => {
              const parts = u.split('/');
              return parts.slice(-2).join('/');
            })
            .join(' → ');
          return {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: DiagnosticSeverity.Error,
            message: `Circular render detected: ${cycleDescription}\nThis will cause an infinite loop at runtime.`,
            source: 'platformos-check',
          };
        });

        this.connection.sendNotification(PublishDiagnosticsNotification.type, {
          uri,
          diagnostics,
        });
      }
    }

    // Clear diagnostics for URIs that are no longer affected
    for (const uri of this.cycleAffectedUris) {
      if (!newlyAffectedUris.has(uri)) {
        this.connection.sendNotification(PublishDiagnosticsNotification.type, {
          uri,
          diagnostics: [],
        });
      }
    }

    this.cycleAffectedUris = newlyAffectedUris;
  }

  private buildAppGraph = async (rootUri: string, entryPoints?: string[]) => {
    const { documentManager } = this;
    await documentManager.preload(rootUri);

    const dependencies = await this.graphDependencies(rootUri);
    const graph = await buildAppGraph(rootUri, dependencies, entryPoints);
    this.detectAndPublishCycles(graph);
    return graph;
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
