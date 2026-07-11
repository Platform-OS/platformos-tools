import { path as pathUtils } from '@platformos/platformos-check-common';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import {
  AppGraph,
  AppModule,
  AssetModule,
  Dependencies,
  LiquidModule,
  LiquidModuleKind,
  ModuleType,
  Reference,
} from '../types';
import { getGraphQLModuleByUri, getPartialModuleByUri } from './module';
import { fixturesRoot, getDependencies } from './test-helpers';

/**
 * A module compared for its EDGE identity. Self-structural (`LiquidModule.structural`,
 * TASK-9.3) is a separate concern, pinned exhaustively in `structural.spec.ts`;
 * stripping it here keeps these edge tests focused and stable as structural grows.
 */
function edgeIdentity(module: AppModule | undefined): AppModule | undefined {
  if (module && module.type === ModuleType.Liquid) {
    const copy = { ...module };
    delete copy.structural;
    return copy;
  }
  return module;
}

/**
 * The exact source range of `snippet` within `source`. Derived from the fixture
 * text (rather than hard-coded offsets) so the assertion is self-documenting
 * and survives edits to unrelated lines.
 */
function rangeOf(source: string, snippet: string): [number, number] {
  const start = source.indexOf(snippet);
  if (start < 0) throw new Error(`snippet not found in fixture: ${snippet}`);
  return [start, start + snippet.length];
}

/** A `direct` dependency Reference with no target range (the common case here). */
function directRef(
  sourceUri: string,
  sourceRange: [number, number],
  targetUri: string,
  kind: Reference['kind'],
  args?: string[],
): Reference {
  return {
    source: { uri: sourceUri, range: sourceRange },
    target: { uri: targetUri },
    type: 'direct',
    kind,
    ...(args ? { args } : {}),
  };
}

const partialNode = (uri: string, exists: boolean, references: Reference[]): LiquidModule => ({
  type: ModuleType.Liquid,
  kind: LiquidModuleKind.Partial,
  uri,
  exists,
  dependencies: [],
  references,
});

describe('URI normalization in graph node factories', () => {
  const emptyGraph = (): AppGraph => ({
    rootUri: 'file:///app',
    entryPoints: [],
    modules: {},
  });

  it('getPartialModuleByUri returns a Partial node with a forward-slash URI', () => {
    const mod = getPartialModuleByUri(
      emptyGraph(),
      'file:///d:/a/repo\\app\\lib\\queries\\list.liquid',
    );
    expect(mod).toEqual({
      type: ModuleType.Liquid,
      kind: LiquidModuleKind.Partial,
      uri: 'file:///d:/a/repo/app/lib/queries/list.liquid',
      dependencies: [],
      references: [],
    });
  });

  it('getGraphQLModuleByUri returns a GraphQL node with a forward-slash URI', () => {
    const mod = getGraphQLModuleByUri(
      emptyGraph(),
      'file:///d:/a/repo\\app\\graphql\\find.graphql',
    );
    expect(mod).toEqual({
      type: ModuleType.GraphQL,
      kind: 'graphql',
      uri: 'file:///d:/a/repo/app/graphql/find.graphql',
      dependencies: [],
      references: [],
      tables: [],
    });
  });
});

describe('Graph traversal: {% function %} edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'function-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;
  let brokenSource: string;

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
    brokenSource = (await dependencies.getSourceCode(p('app/views/pages/broken.liquid'))).source;
  }, 15000);

  it('links a page to the resolved lib query via a single function edge', () => {
    const edge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "function items = 'queries/list'"),
      p('app/lib/queries/list.liquid'),
      'function',
    );
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([edge]);
    expect(edgeIdentity(graph.modules[p('app/lib/queries/list.liquid')])).toEqual(
      partialNode(p('app/lib/queries/list.liquid'), true, [edge]),
    );
  });

  it('records a missing function target as an exists:false node', () => {
    const edge = directRef(
      p('app/views/pages/broken.liquid'),
      rangeOf(brokenSource, "function ghost = 'queries/missing'"),
      p('app/lib/queries/missing.liquid'),
      'function',
    );
    expect(graph.modules[p('app/lib/queries/missing.liquid')]).toEqual(
      partialNode(p('app/lib/queries/missing.liquid'), false, [edge]),
    );
  });
});

describe('Graph traversal: {% graphql %} edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'graphql-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;
  let brokenSource: string;

  const graphqlNode = (
    uri: string,
    exists: boolean,
    references: Reference[],
    tables: string[] = [],
  ) => ({
    type: ModuleType.GraphQL,
    kind: 'graphql' as const,
    uri,
    exists,
    dependencies: [],
    references,
    tables,
  });

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
    brokenSource = (await dependencies.getSourceCode(p('app/views/pages/broken.liquid'))).source;
  }, 15000);

  it('links a page to the resolved .graphql operation via a single graphql edge', () => {
    const edge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "graphql posts = 'blog_posts/find', id: '1'"),
      p('app/graphql/blog_posts/find.graphql'),
      'graphql',
      ['id'],
    );
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([edge]);
    // The resolved GraphQL node carries the model `table` it targets (the fixture
    // operation filters on `table: { value: "blog_post" }`).
    expect(graph.modules[p('app/graphql/blog_posts/find.graphql')]).toEqual(
      graphqlNode(p('app/graphql/blog_posts/find.graphql'), true, [edge], ['blog_post']),
    );
  });

  it('records a missing graphql target as an exists:false GraphQL node', () => {
    const edge = directRef(
      p('app/views/pages/broken.liquid'),
      rangeOf(brokenSource, "graphql ghost = 'blog_posts/missing'"),
      p('app/graphql/blog_posts/missing.graphql'),
      'graphql',
    );
    expect(graph.modules[p('app/graphql/blog_posts/missing.graphql')]).toEqual(
      graphqlNode(p('app/graphql/blog_posts/missing.graphql'), false, [edge]),
    );
  });
});

describe('Graph traversal: GraphQL node `tables` (build-time, both shapes)', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'graphql-table');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;

  beforeAll(async () => {
    graph = await buildAppGraph(rootUri, getDependencies());
  }, 15000);

  it('records the tables for an operation that filters on one', () => {
    const node = graph.modules[p('app/graphql/with_table.graphql')];
    assert(node);
    assert(node.type === ModuleType.GraphQL);
    expect(node.tables).toEqual(['blog_post']);
  });

  it('leaves tables empty for an operation with no table filter', () => {
    const node = graph.modules[p('app/graphql/without_table.graphql')];
    assert(node);
    assert(node.type === ModuleType.GraphQL);
    expect(node.tables).toEqual([]);
  });
});

describe('Graph traversal: {% include %} edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'include-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
  }, 15000);

  it('tags an include edge with kind "include" (distinct from render)', () => {
    const edge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "{% include 'shared/header' %}"),
      p('app/views/partials/shared/header.liquid'),
      'include',
    );
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([edge]);
    expect(edgeIdentity(graph.modules[p('app/views/partials/shared/header.liquid')])).toEqual(
      partialNode(p('app/views/partials/shared/header.liquid'), true, [edge]),
    );
  });
});

describe('Graph traversal: {% background %} edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'background-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;
  let brokenSource: string;

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
    brokenSource = (await dependencies.getSourceCode(p('app/views/pages/broken.liquid'))).source;
  }, 15000);

  it('links a page to the background partial via a single background edge', () => {
    const edge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "background job_id = 'jobs/notify', data: 'x'"),
      p('app/views/partials/jobs/notify.liquid'),
      'background',
      ['data'],
    );
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([edge]);
    expect(edgeIdentity(graph.modules[p('app/views/partials/jobs/notify.liquid')])).toEqual(
      partialNode(p('app/views/partials/jobs/notify.liquid'), true, [edge]),
    );
  });

  it('records a missing background target as an exists:false node', () => {
    const edge = directRef(
      p('app/views/pages/broken.liquid'),
      rangeOf(brokenSource, "background job_id = 'jobs/missing'"),
      p('app/lib/jobs/missing.liquid'),
      'background',
    );
    expect(graph.modules[p('app/lib/jobs/missing.liquid')]).toEqual(
      partialNode(p('app/lib/jobs/missing.liquid'), false, [edge]),
    );
  });
});

describe('Graph traversal: module-namespaced targets (modules/<name>/public/...)', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'module-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
  }, 15000);

  it('resolves function + render targets into modules/<name>/public/{lib,views/partials}', () => {
    const functionEdge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "function items = 'modules/my_module/queries/get'"),
      p('modules/my_module/public/lib/queries/get.liquid'),
      'function',
    );
    const renderEdge = directRef(
      p('app/views/pages/index.liquid'),
      rangeOf(indexSource, "{% render 'modules/my_module/card' %}"),
      p('modules/my_module/public/views/partials/card.liquid'),
      'render',
    );

    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([
      functionEdge,
      renderEdge,
    ]);
    expect(
      edgeIdentity(graph.modules[p('modules/my_module/public/lib/queries/get.liquid')]),
    ).toEqual(
      partialNode(p('modules/my_module/public/lib/queries/get.liquid'), true, [functionEdge]),
    );
    expect(
      edgeIdentity(graph.modules[p('modules/my_module/public/views/partials/card.liquid')]),
    ).toEqual(
      partialNode(p('modules/my_module/public/views/partials/card.liquid'), true, [renderEdge]),
    );
  });
});

describe('Graph traversal: layout-association edges (frontmatter `layout:`)', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'layout-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;
  let brokenSource: string;

  const layoutNode = (uri: string, exists: boolean, references: Reference[]): LiquidModule => ({
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Layout,
    uri,
    exists,
    dependencies: [],
    references,
  });

  /**
   * The source range the layout edge carries — the whole `YAMLFrontmatter`
   * block, from the opening fence through the closing `---` line (incl. its
   * trailing newline). Derived from the fixture text so it survives edits.
   */
  const frontmatterRange = (source: string): [number, number] => [
    0,
    source.indexOf('\n', source.indexOf('---', 3)) + 1,
  ];

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
    brokenSource = (await dependencies.getSourceCode(p('app/views/pages/broken.liquid'))).source;
  }, 15000);

  it('links a page to its resolved layout via a single layout edge', () => {
    const edge = directRef(
      p('app/views/pages/index.liquid'),
      frontmatterRange(indexSource),
      p('app/views/layouts/theme.liquid'),
      'layout',
    );
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toEqual([edge]);
    expect(edgeIdentity(graph.modules[p('app/views/layouts/theme.liquid')])).toEqual(
      layoutNode(p('app/views/layouts/theme.liquid'), true, [edge]),
    );
  });

  it('records a missing layout target as an exists:false Layout node', () => {
    const edge = directRef(
      p('app/views/pages/broken.liquid'),
      frontmatterRange(brokenSource),
      p('app/views/layouts/ghost.liquid'),
      'layout',
    );
    expect(graph.modules[p('app/views/pages/broken.liquid')].dependencies).toEqual([edge]);
    expect(graph.modules[p('app/views/layouts/ghost.liquid')]).toEqual(
      layoutNode(p('app/views/layouts/ghost.liquid'), false, [edge]),
    );
  });
});

describe('Graph traversal: asset edges (asset_url resolves under app/assets)', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'asset-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;
  let indexSource: string;

  const assetNode = (uri: string, exists: boolean, references: Reference[]): AssetModule => ({
    type: ModuleType.Asset,
    kind: 'unused',
    uri,
    exists,
    dependencies: [],
    references,
  });

  // The asset edge carries the `{{ … }}` output's LiquidVariable range: from the
  // first char after `{{ ` up to the `}}` (the parser includes the trailing
  // space). Derived from the fixture text around the given literal so it stays
  // correct as the fixture changes.
  const outputRange = (literal: string): [number, number] => {
    const at = indexSource.indexOf(literal);
    if (at < 0) throw new Error(`literal not found in fixture: ${literal}`);
    return [indexSource.lastIndexOf('{{', at) + '{{ '.length, indexSource.indexOf('}}', at)];
  };

  const assetEdge = (literal: string, targetPart: string): Reference =>
    directRef(p('app/views/pages/index.liquid'), outputRange(literal), p(targetPart), 'asset');

  beforeAll(async () => {
    const dependencies: Dependencies = getDependencies();
    graph = await buildAppGraph(rootUri, dependencies);
    indexSource = (await dependencies.getSourceCode(p('app/views/pages/index.liquid'))).source;
  }, 15000);

  it('resolves an asset (relative to app/assets) to an exists:true Asset node', () => {
    const edge = assetEdge("'site/app.js'", 'app/assets/site/app.js');
    expect(graph.modules[p('app/views/pages/index.liquid')].dependencies).toContainEqual(edge);
    expect(graph.modules[p('app/assets/site/app.js')]).toEqual(
      assetNode(p('app/assets/site/app.js'), true, [edge]),
    );
  });

  it('resolves a top-level asset under app/assets', () => {
    const edge = assetEdge("'logo.css'", 'app/assets/logo.css');
    expect(graph.modules[p('app/assets/logo.css')]).toEqual(
      assetNode(p('app/assets/logo.css'), true, [edge]),
    );
  });

  it('records a missing asset as an exists:false Asset node at its canonical app/assets path', () => {
    const edge = assetEdge("'images/missing.png'", 'app/assets/images/missing.png');
    expect(graph.modules[p('app/assets/images/missing.png')]).toEqual(
      assetNode(p('app/assets/images/missing.png'), false, [edge]),
    );
  });

  it('emits exactly the three asset edges for the page, in source order', () => {
    expect(
      graph.modules[p('app/views/pages/index.liquid')].dependencies.map((d) => ({
        kind: d.kind,
        target: d.target.uri,
      })),
    ).toEqual([
      { kind: 'asset', target: p('app/assets/site/app.js') },
      { kind: 'asset', target: p('app/assets/logo.css') },
      { kind: 'asset', target: p('app/assets/images/missing.png') },
    ]);
  });
});

describe('Graph traversal: schema/CustomModelType nodes (full-build discovery)', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'schema-nodes');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;

  beforeAll(async () => {
    graph = await buildAppGraph(rootUri, getDependencies());
  }, 15000);

  it('discovers a schema file as a leaf Schema node carrying its table (the YAML name)', () => {
    expect(graph.modules[p('app/schema/blog_post.yml')]).toEqual({
      type: ModuleType.Schema,
      kind: 'schema',
      uri: p('app/schema/blog_post.yml'),
      exists: true,
      dependencies: [],
      references: [],
      table: 'blog_post',
    });
  });

  it('leaves table undefined for a schema file with no `name:`', () => {
    expect(graph.modules[p('app/schema/no_name.yml')]).toEqual({
      type: ModuleType.Schema,
      kind: 'schema',
      uri: p('app/schema/no_name.yml'),
      exists: true,
      dependencies: [],
      references: [],
    });
  });

  it('does not make schema files entry points', () => {
    expect(graph.entryPoints.map((m) => m.uri)).toEqual([p('app/views/pages/index.liquid')]);
  });
});
