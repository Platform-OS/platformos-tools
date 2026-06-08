/**
 * Project fact graph — typed, queryable view over a `ProjectMap`.
 *
 * Built once per `validate_code` call and passed through the rule engine
 * as `facts.graph`. Indexes every file, schema, GraphQL op, layout,
 * translation entry, and asset as a `FactNode`; computes file → file
 * dependency edges via the resolvers in `dependency-graph.ts`; and
 * separately indexes `{% render %}` call-sites so render-flow analysis
 * can answer "who passes which args to which partial".
 *
 * v1 trim: dropped `allFiles`, `allLiquidFiles`, `allCheckableFiles`,
 * `size`, `nodeCount`, `edgeCount`, `toDependencyGraph`, and
 * `checkEdgeIntegrity` — those are consumed by `analyze-project` / dashboard
 * code that is out of scope. The remaining surface matches every method
 * called by the in-scope rule files, render-flow, and validate-code.
 */

import {
  resolveFunctionTarget,
  resolveGraphqlTarget,
  resolveRenderTarget,
} from './dependency-graph';
import type {
  CommandEntry,
  FunctionCall,
  GraphqlArg,
  GraphqlEntry,
  LayoutEntry,
  PageEntry,
  PartialEntry,
  ProjectMap,
  QueryEntry,
  SchemaEntry,
  SchemaProperty,
} from './project-scanner';
import type { GraphqlRef, RenderCall } from './liquid-parser';

export type FactNodeType =
  | 'page'
  | 'partial'
  | 'command'
  | 'query'
  | 'graphql'
  | 'schema'
  | 'layout'
  | 'translation'
  | 'asset';

/**
 * Per-type fields are optional and present only on the nodes that carry
 * them. Source code accesses them dynamically (`node.params`, etc.); this
 * interface mirrors that with explicit, typed optionals.
 */
export interface FactNode {
  readonly type: FactNodeType;
  readonly key: string;
  readonly path: string | null;

  // page / partial / layout
  readonly slug?: string;
  readonly method?: string;
  readonly layout?: string | null;
  readonly renders?: string[];
  readonly render_calls?: RenderCall[];
  readonly function_calls?: FunctionCall[];
  readonly graphql_calls?: GraphqlRef[];

  // partial / command / query
  readonly params?: string[];
  readonly phases?: string[];
  readonly rendered_by?: string[];

  // graphql operation
  readonly operation?: string | null;
  readonly gqlName?: string | null;
  readonly args?: GraphqlArg[];
  readonly table?: string | null;

  // schema
  readonly properties?: SchemaProperty[];

  // translation
  readonly locale?: string;
  readonly value?: unknown;
}

/** A single `{% render %}` call-site recorded against the calling file. */
export interface RenderCallRef extends RenderCall {}

/** `(caller path, args passed)` pair returned by `renderCallsTo`. */
export interface RenderCallerRef {
  callerPath: string;
  args: string[];
}

/** Factory — preserves the source's `buildFactGraph(map)` entry point. */
export function buildFactGraph(projectMap: ProjectMap): ProjectFactGraph {
  return new ProjectFactGraph(projectMap);
}

export class ProjectFactGraph {
  private readonly _nodes = new Map<string, FactNode>();
  private readonly _byType = new Map<FactNodeType, Map<string, FactNode>>();
  private readonly _dependsOn = new Map<string, Set<string>>();
  private readonly _referencedBy = new Map<string, Set<string>>();
  private readonly _renderCalls = new Map<string, RenderCall[]>();

  constructor(private readonly _map: ProjectMap) {
    this._indexNodes();
    this._buildEdges();
    this._indexRenderCalls();
  }

  // ── Index construction ─────────────────────────────────────────────────

  private _addNode(
    type: FactNodeType,
    key: string,
    path: string | null,
    props: Partial<FactNode> = {},
  ): FactNode {
    const node = Object.freeze<FactNode>({ type, key, path, ...props });
    if (path) this._nodes.set(path, node);
    let bucket = this._byType.get(type);
    if (!bucket) {
      bucket = new Map();
      this._byType.set(type, bucket);
    }
    bucket.set(key, node);
    return node;
  }

  private _addEdge(source: string | null, target: string | null): void {
    if (!source || !target) return;
    let depBucket = this._dependsOn.get(source);
    if (!depBucket) {
      depBucket = new Set();
      this._dependsOn.set(source, depBucket);
    }
    let refBucket = this._referencedBy.get(target);
    if (!refBucket) {
      refBucket = new Set();
      this._referencedBy.set(target, refBucket);
    }
    depBucket.add(target);
    refBucket.add(source);
  }

  private _indexNodes(): void {
    const m = this._map;

    for (const [key, page] of Object.entries(m.pages ?? {})) {
      this._addPageNode(key, page);
    }
    for (const [name, partial] of Object.entries(m.partials ?? {})) {
      this._addPartialNode(name, partial);
    }
    for (const [path, cmd] of Object.entries(m.commands ?? {})) {
      this._addCommandNode(path, cmd);
    }
    for (const [path, q] of Object.entries(m.queries ?? {})) {
      this._addQueryNode(path, q);
    }
    for (const [name, gql] of Object.entries(m.graphql ?? {})) {
      this._addGraphqlNode(name, gql);
    }
    for (const [name, schema] of Object.entries(m.schema ?? {})) {
      this._addSchemaNode(name, schema);
    }
    for (const [, layout] of Object.entries(m.layouts ?? {})) {
      this._addLayoutNode(layout);
    }
    for (const [locale, keys] of Object.entries(m.translations ?? {})) {
      for (const [key, value] of Object.entries(keys)) {
        this._addNode('translation', `${locale}:${key}`, null, { locale, key, value });
      }
    }
    for (const asset of m.assets ?? []) {
      this._addNode('asset', asset, `app/assets/${asset}`);
    }
  }

  private _addPageNode(key: string, page: PageEntry): void {
    this._addNode('page', key, page.path, {
      slug: page.slug,
      method: page.method,
      layout: page.layout,
      renders: page.renders,
      render_calls: page.render_calls,
      function_calls: page.function_calls,
      graphql_calls: page.graphql_calls,
    });
  }

  private _addPartialNode(name: string, partial: PartialEntry): void {
    this._addNode('partial', name, partial.path, {
      params: partial.params,
      renders: partial.renders,
      render_calls: partial.render_calls,
      function_calls: partial.function_calls,
      rendered_by: partial.rendered_by,
      graphql_calls: partial.graphql_calls,
    });
  }

  private _addCommandNode(path: string, cmd: CommandEntry): void {
    this._addNode('command', path, path, {
      params: cmd.params,
      phases: cmd.phases,
      graphql_calls: cmd.graphql_calls,
      function_calls: cmd.function_calls,
    });
  }

  private _addQueryNode(path: string, q: QueryEntry): void {
    this._addNode('query', path, path, {
      params: q.params,
      graphql_calls: q.graphql_calls,
      function_calls: q.function_calls,
    });
  }

  private _addGraphqlNode(name: string, gql: GraphqlEntry): void {
    this._addNode('graphql', name, `app/graphql/${name}.graphql`, {
      operation: gql.operation,
      gqlName: gql.name,
      args: gql.args,
      table: gql.table,
    });
  }

  private _addSchemaNode(name: string, schema: SchemaEntry): void {
    this._addNode('schema', name, schema.path, { properties: schema.properties });
  }

  private _addLayoutNode(layout: LayoutEntry): void {
    this._addNode('layout', layout.path, layout.path, {
      renders: layout.renders,
      render_calls: layout.render_calls,
      function_calls: layout.function_calls,
      graphql_calls: layout.graphql_calls,
    });
  }

  private _buildEdges(): void {
    const m = this._map;

    const layoutsByName: Record<string, string> = {};
    for (const layout of Object.values(m.layouts ?? {})) {
      if (!layout.path) continue;
      const name = layout.path
        .replace(/^app\/views\/layouts\//, '')
        .replace(/\.html\.liquid$/, '')
        .replace(/\.liquid$/, '');
      layoutsByName[name] = layout.path;
    }

    for (const page of Object.values(m.pages ?? {})) {
      if (!page.path) continue;
      for (const r of page.renders ?? []) {
        this._addEdge(page.path, resolveRenderTarget(r, m, page.path));
      }
      for (const fc of page.function_calls ?? []) {
        this._addEdge(page.path, resolveFunctionTarget(fc.path));
      }
      if (page.layout) {
        const layoutPath = layoutsByName[page.layout];
        if (layoutPath) this._addEdge(page.path, layoutPath);
      }
    }

    for (const layout of Object.values(m.layouts ?? {})) {
      if (!layout.path) continue;
      for (const r of layout.renders ?? []) {
        this._addEdge(layout.path, resolveRenderTarget(r, m, layout.path));
      }
      for (const fc of layout.function_calls ?? []) {
        this._addEdge(layout.path, resolveFunctionTarget(fc.path));
      }
    }

    for (const partial of Object.values(m.partials ?? {})) {
      if (!partial.path) continue;
      for (const r of partial.renders ?? []) {
        this._addEdge(partial.path, resolveRenderTarget(r, m, partial.path));
      }
      for (const fc of partial.function_calls ?? []) {
        this._addEdge(partial.path, resolveFunctionTarget(fc.path));
      }
    }

    for (const [cmdPath, cmd] of Object.entries(m.commands ?? {})) {
      for (const fc of cmd.function_calls ?? []) {
        this._addEdge(cmdPath, resolveFunctionTarget(fc.path));
      }
      for (const g of cmd.graphql_calls ?? []) {
        this._addEdge(cmdPath, resolveGraphqlTarget(g.queryName));
      }
    }

    for (const [qPath, q] of Object.entries(m.queries ?? {})) {
      for (const fc of q.function_calls ?? []) {
        this._addEdge(qPath, resolveFunctionTarget(fc.path));
      }
      for (const g of q.graphql_calls ?? []) {
        this._addEdge(qPath, resolveGraphqlTarget(g.queryName));
      }
    }
  }

  private _indexRenderCalls(): void {
    for (const [path, node] of this._nodes) {
      const calls = node.render_calls;
      if (calls && calls.length > 0) {
        this._renderCalls.set(path, calls);
      }
    }
  }

  // ── Public query API ───────────────────────────────────────────────────

  nodeByPath(path: string | null | undefined): FactNode | null {
    if (!path) return null;
    return this._nodes.get(path) ?? null;
  }

  nodesByType(type: FactNodeType): FactNode[] {
    const bucket = this._byType.get(type);
    return bucket ? [...bucket.values()] : [];
  }

  nodeByKey(type: FactNodeType, key: string): FactNode | null {
    return this._byType.get(type)?.get(key) ?? null;
  }

  hasNode(path: string | null | undefined): boolean {
    if (!path) return false;
    return this._nodes.has(path);
  }

  dependsOn(path: string): string[] {
    return [...(this._dependsOn.get(path) ?? [])];
  }

  referencedBy(path: string): string[] {
    return [...(this._referencedBy.get(path) ?? [])];
  }

  renderCallsFrom(filePath: string): RenderCall[] {
    return this._renderCalls.get(filePath) ?? [];
  }

  renderCallsTo(partialKey: string): RenderCallerRef[] {
    const results: RenderCallerRef[] = [];
    for (const [callerPath, calls] of this._renderCalls) {
      for (const call of calls) {
        if (call.partial === partialKey) {
          results.push({ callerPath, args: call.args });
        }
      }
    }
    return results;
  }

  /** Declared `@param` list for a partial, or `null` if unknown. */
  partialSignature(partialKey: string): string[] | null {
    const node = this.nodeByKey('partial', partialKey);
    if (!node) return null;
    return node.params ?? [];
  }
}
