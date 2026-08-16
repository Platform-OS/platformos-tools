import { path as pathUtils, SourceCodeType } from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import {
  AbstractFileSystem,
  App,
  UriString,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import { assert, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { buildAppGraph } from '../index';
import { toSourceCode } from '../toSourceCode';
import {
  AppGraph,
  AppModule,
  AssetModule,
  Dependencies,
  LiquidModule,
  LiquidModuleKind,
  ModuleStructural,
  ModuleType,
  Reference,
} from '../types';
import { unique } from '../utils';
import { getGraphQLModuleByUri, getPartialModuleByUri } from './module';
import { fixturesRoot, getDependencies, makeGetSourceCode, skeleton } from './test-helpers';

describe('Module: index', () => {
  const rootUri = skeleton;
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  const loc = (part: string) => expect.objectContaining({ uri: p(part) });
  let dependencies: Dependencies;

  beforeAll(async () => {
    dependencies = getDependencies();
  }, 15000);

  describe('Unit: buildAppGraph', { timeout: 10000 }, () => {
    it('builds a graph of the app', { timeout: 10000 }, async () => {
      const graph = await buildAppGraph(rootUri, dependencies);
      expect(graph).toBeDefined();
    });

    describe('with a valid app graph', () => {
      let graph: AppGraph;

      beforeEach(async () => {
        graph = await buildAppGraph(rootUri, dependencies);
      });

      it('has a root URI', () => {
        expect(graph.rootUri).toBeDefined();
        expect(graph.rootUri).toBe(rootUri);
      });

      it('infers entry points from layouts and pages', () => {
        expect(graph.entryPoints).toHaveLength(2);
        expect(graph.entryPoints.map((x) => x.uri)).toEqual(
          expect.arrayContaining([
            p('app/views/layouts/application.liquid'),
            p('app/views/pages/index.liquid'),
          ]),
        );
      });

      it("finds app/views/layouts/application.liquid's dependencies", () => {
        const layout = graph.modules[p('app/views/layouts/application.liquid')];
        assert(layout);
        assert(layout.type === ModuleType.Liquid);
        assert(layout.kind === LiquidModuleKind.Layout);

        const deps = layout.dependencies;
        expect(deps.map((x) => x.target.uri)).toEqual(
          expect.arrayContaining([
            p('app/assets/app.js'),
            p('app/assets/app.css'),
            p('app/views/partials/header.liquid'),
          ]),
        );
      });

      it("finds app/views/partials/parent's dependencies and references", async () => {
        const parentPartial = graph.modules[p('app/views/partials/parent.liquid')];
        assert(parentPartial);
        assert(parentPartial.type === ModuleType.Liquid);
        assert(parentPartial.kind === LiquidModuleKind.Partial);

        // outgoing links — parent renders exactly one partial (child)
        const deps = parentPartial.dependencies;
        assert(deps.map((x) => x.source.uri).every((x) => x === parentPartial.uri));
        expect(deps.map((x) => x.target.uri)).toEqual([p('app/views/partials/child.liquid')]);

        // {% render 'child' %} dependency
        const parentSource = await dependencies.getSourceCode(
          p('app/views/partials/parent.liquid'),
        );
        assert(parentSource);
        assert(parentSource.type === SourceCodeType.LiquidHtml);
        expect(parentPartial.dependencies.map((x) => x.source)).toContainEqual(
          expect.objectContaining({
            uri: p('app/views/partials/parent.liquid'),
            range: [
              parentSource.source.indexOf('{% render "child"'),
              parentSource.source.indexOf('{% render "child"') +
                '{% render "child", children: children %}'.length,
            ],
          }),
        );
      });

      it("finds app/views/partials/child's references", () => {
        const childPartial = graph.modules[p('app/views/partials/child.liquid')];
        assert(childPartial);
        assert(childPartial.type === ModuleType.Liquid);
        assert(childPartial.kind === LiquidModuleKind.Partial);

        const refs = childPartial.references;
        expect(refs.map((x) => x.source.uri)).toEqual(
          expect.arrayContaining([
            p('app/views/partials/parent.liquid'),
            p('app/views/partials/header.liquid'),
          ]),
        );
      });

      it('tags every layout edge with its kind (asset, asset, render)', () => {
        const layout = graph.modules[p('app/views/layouts/application.liquid')];
        assert(layout);

        // The complete, ordered edge set — not a membership probe — so an extra,
        // missing, or mis-kinded edge fails. (Source ranges are pinned by the
        // dedicated render-dependency test above.)
        expect(
          layout.dependencies.map((d) => ({ target: d.target.uri, type: d.type, kind: d.kind })),
        ).toEqual([
          { target: p('app/assets/app.js'), type: 'direct', kind: 'asset' },
          { target: p('app/assets/app.css'), type: 'direct', kind: 'asset' },
          { target: p('app/views/partials/header.liquid'), type: 'direct', kind: 'render' },
        ]);
      });
    });

    /**
     * Entry points come from an ANCHORED walk of the app subtrees, so what a
     * directory is CALLED never decides whether the graph can see it. The walk this
     * replaced skipped any directory ending in `vendor`, `build`, `tmp` or `dist`,
     * which lost every page under `app/views/pages/vendor/**` — a real section of a
     * real site — while still descending into `tmp/app/views/pages/`, which the
     * platform does not deploy at all.
     */
    describe('entry points on a project with app directories named like build output', () => {
      const projectRoot = 'file:///project';
      const u = (part: string) => `${projectRoot}/${part}`;

      let graph: AppGraph;

      beforeEach(async () => {
        const fs = new MockFileSystem(
          {
            'app/views/pages/vendor/index.liquid': `{% render 'vendor/card' %}`,
            'app/views/pages/build/status.liquid': `ok`,
            'app/views/partials/vendor/card.liquid': `a card`,
            'tmp/app/views/pages/scratch.liquid': `not deployed`,
            'node_modules/some-pkg/app/views/pages/decoy.liquid': `not ours`,
            'dist/app/views/pages/bundled.liquid': `build output`,
          },
          projectRoot,
        );

        graph = await buildAppGraph(projectRoot, {
          fs,
          getSourceCode: async (uri: string) => toSourceCode(uri, await fs.readFile(uri)),
        });
      });

      it('finds the pages under vendor/ and build/, and nothing outside the app subtrees', () => {
        expect(graph.entryPoints.map((entry) => entry.uri).sort()).toEqual([
          u('app/views/pages/build/status.liquid'),
          u('app/views/pages/vendor/index.liquid'),
        ]);
      });

      it('traverses them, so a partial under vendor/ is a graph node with a reference', () => {
        const card = graph.modules[u('app/views/partials/vendor/card.liquid')];
        assert(card);
        expect(card.references.map((reference) => reference.source.uri)).toEqual([
          u('app/views/pages/vendor/index.liquid'),
        ]);
      });
    });
  });
});

/**
 * a Liquid file's own structural declarations.
 */
describe('Self-structural: page routing + AST usage facts', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'structural');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  let graph: AppGraph;

  const structuralOf = (uri: string): ModuleStructural | undefined => {
    const module = graph.modules[uri];
    assert(module);
    assert(module.type === ModuleType.Liquid);
    return module.structural;
  };

  /** The empty usage arrays — spread into expectations so each asserts the whole object. */
  const NO_USAGE = {
    renders_used: [],
    graphql_queries_used: [],
    filters_used: [],
    tags_used: [],
    translation_keys: [],
    doc_params: [],
  };

  beforeAll(async () => {
    graph = await buildAppGraph(rootUri, getDependencies(), undefined, { includeStructural: true });
  }, 15000);

  it('derives slug from the page path and carries declared layout + method + its renders', () => {
    expect(structuralOf(p('app/views/pages/index.liquid'))).toEqual({
      ...NO_USAGE,
      renders_used: ['card', 'documented'],
      tags_used: ['render'],
      slug: '/',
      layout: 'application',
      method: 'get',
    });
  });

  it('collects `{% doc %}` @param names in declaration order', () => {
    // `{% doc %}` is a raw tag (not a LiquidTag), so it does not appear in
    // tags_used; its @param names are surfaced via doc_params, in source order.
    expect(structuralOf(p('app/views/partials/documented.liquid'))).toEqual({
      ...NO_USAGE,
      doc_params: ['title', 'count'],
    });
  });

  it('derives the slug from the path for a page with no frontmatter and no usage', () => {
    expect(structuralOf(p('app/views/pages/about.liquid'))).toEqual({
      ...NO_USAGE,
      slug: 'about',
    });
  });

  it('uses the frontmatter slug override verbatim (not the path)', () => {
    expect(structuralOf(p('app/views/pages/blog/show.liquid'))).toEqual({
      ...NO_USAGE,
      slug: 'blog/custom',
    });
  });

  it('gives a partial all-empty usage arrays and no routing facts', () => {
    expect(structuralOf(p('app/views/partials/card.liquid'))).toEqual({ ...NO_USAGE });
  });

  it('collects every AST usage fact (renders/graphql/filters/tags/translation) sorted + de-duplicated', () => {
    expect(structuralOf(p('app/views/pages/rich.liquid'))).toEqual({
      renders_used: ['card'],
      graphql_queries_used: ['blog/find'],
      filters_used: ['t', 'upcase'],
      tags_used: ['assign', 'graphql', 'if', 'render'],
      translation_keys: ['greeting.hello'],
      doc_params: [],
      slug: 'rich',
      layout: 'application',
    });
  });
});

describe('Self-structural: the includeStructural opt-in', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'structural');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  const liquidModule = (graph: AppGraph, uri: string): LiquidModule => {
    const module = graph.modules[uri];
    assert(module);
    assert(module.type === ModuleType.Liquid);
    return module;
  };

  it('does NOT populate `structural` on a default build (the LSP opt-out)', async () => {
    const graph = await buildAppGraph(rootUri, getDependencies());
    expect(liquidModule(graph, p('app/views/pages/index.liquid')).structural).toBeUndefined();
  });

  it('populates `structural` only when opted in', async () => {
    const graph = await buildAppGraph(rootUri, getDependencies(), undefined, {
      includeStructural: true,
    });
    expect(liquidModule(graph, p('app/views/pages/index.liquid')).structural).toEqual({
      renders_used: ['card', 'documented'],
      graphql_queries_used: [],
      filters_used: [],
      tags_used: ['render'],
      translation_keys: [],
      doc_params: [],
      slug: '/',
      layout: 'application',
      method: 'get',
    });
  });
});

/**
 * A module compared for its EDGE identity. Self-structural (`LiquidModule.structural`) is a
 * separate concern, pinned exhaustively in `traverse.spec.ts`;
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

describe('Graph traversal: schema/Table nodes (full-build discovery)', () => {
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

/**
 * The graph resolves `{% render %}` / `{% function %}` / `{% graphql %}` / `layout:`
 * targets through `IDependencies.app`'s index when it is given one.
 */
const moduleEdges = pathUtils.join(fixturesRoot, 'module-edges');

/** The real filesystem, with every directory listing recorded. */
function recordingFs(): { fs: AbstractFileSystem; listedDirectories: UriString[] } {
  const listedDirectories: UriString[] = [];
  const fs: AbstractFileSystem = {
    stat: (uri) => NodeFileSystem.stat(uri),
    readFile: (uri) => NodeFileSystem.readFile(uri),
    readDirectory: (uri) => {
      listedDirectories.push(uri);
      return NodeFileSystem.readDirectory(uri);
    },
  };
  return { fs, listedDirectories };
}

/** Every source file under the root, classified — the app the language server holds. */
async function wholeApp(rootUri: UriString, fs: AbstractFileSystem): Promise<App> {
  return App.fromPaths(rootUri, await walkAppSourceFiles(fs, rootUri), fs);
}

/** An app that knows the entry points and nothing else, so every target is an index MISS. */
async function pagesOnlyApp(rootUri: UriString, fs: AbstractFileSystem): Promise<App> {
  const whole = await wholeApp(rootUri, fs);
  return App.fromPaths(
    rootUri,
    whole.pages().map((file) => file.uri),
    fs,
  );
}

interface Build {
  graph: AppGraph;
  /** Distinct directories listed while RESOLVING (the walks that precede it are discarded). */
  listedDirectories: UriString[];
  /** Distinct URIs the build asked for a source code, sorted. */
  sourcesRead: UriString[];
}

/**
 * Build the fixture's graph from its pages and layouts, recording what it touched.
 *
 * `entryPoints` are passed explicitly — a discovering build walks the project first, and
 * those listings would swamp the ones under test. The scope is the same one
 * `buildAppGraph` would have discovered for these fixtures.
 */
async function buildRecording(
  rootUri: UriString,
  makeApp?: (rootUri: UriString, fs: AbstractFileSystem) => Promise<App>,
): Promise<Build> {
  const { fs, listedDirectories } = recordingFs();
  const entryPointsApp = await wholeApp(rootUri, fs);
  const entryPoints = [...entryPointsApp.pages(), ...entryPointsApp.layouts()].map(
    (file) => file.uri,
  );
  const app = makeApp ? await makeApp(rootUri, fs) : undefined;

  const sourcesRead: UriString[] = [];
  const getSourceCode = makeGetSourceCode(fs);

  // Everything above is fixture setup — the walks it performed are not what is measured.
  listedDirectories.length = 0;

  const graph = await buildAppGraph(
    rootUri,
    {
      fs,
      app,
      getSourceCode: (uri) => {
        sourcesRead.push(uri);
        return getSourceCode(uri);
      },
    },
    entryPoints,
  );

  return {
    graph,
    // SORTED, not in call order: entry points are traversed concurrently, so which
    // lookup reaches the filesystem first is a scheduling detail. WHICH directories a
    // build has to list is the claim.
    listedDirectories: unique(listedDirectories).sort(),
    sourcesRead: unique(sourcesRead).sort(),
  };
}

const dir = (rootUri: UriString, relative: string): UriString =>
  pathUtils.join(rootUri, ...relative.split('/'));

const referenceKey = (reference: Reference): string =>
  [
    reference.source.uri,
    reference.source.range?.join(':') ?? '',
    reference.kind,
    reference.type,
  ].join('|');

/**
 * The graph with every node's REVERSE index (`references`) in a stable order.
 */
function canonical(graph: AppGraph): AppGraph {
  const sortReferences = (module: AppModule): AppModule => ({
    ...module,
    references: [...module.references].sort((a, b) =>
      referenceKey(a).localeCompare(referenceKey(b)),
    ),
  });

  return {
    ...graph,
    entryPoints: graph.entryPoints.map(sortReferences),
    modules: Object.fromEntries(
      Object.entries(graph.modules).map(([uri, module]) => [uri, sortReferences(module)]),
    ),
  };
}

describe('a graph build over a project with an App index', () => {
  let indexed: Build;
  let unindexed: Build;
  let partialIndex: Build;

  beforeAll(async () => {
    indexed = await buildRecording(skeleton, wholeApp);
    unindexed = await buildRecording(skeleton);
    partialIndex = await buildRecording(skeleton, pagesOnlyApp);
  });

  it('lists no directory but the asset one, because the index answers every name', () => {
    // `app/assets` is here on purpose: `findOrLocate` never indexes an asset, since
    // nothing reads one and the only question is whether it still exists on disk.
    expect(indexed.listedDirectories).toEqual([dir(skeleton, 'app/assets')]);
  });

  it('lists a directory per candidate when there is no index to answer from', () => {
    expect(unindexed.listedDirectories).toEqual([
      dir(skeleton, 'app/assets'),
      dir(skeleton, 'app/views/layouts'),
      dir(skeleton, 'app/views/partials'),
    ]);
  });

  it('builds the same graph with the index as without it', () => {
    expect(canonical(indexed.graph)).toEqual(canonical(unindexed.graph));
  });

  it('falls back to the filesystem for a name the index does not hold', () => {
    expect(canonical(partialIndex.graph)).toEqual(canonical(unindexed.graph));
    // And the miss really was a miss: the partial and layout directories were listed,
    // so the equality above is not an app that quietly answered everything.
    expect(partialIndex.listedDirectories).toEqual(unindexed.listedDirectories);
  });

  it('never asks for an asset source code, only for the files it traverses', () => {
    // An Asset node is a leaf whose only fact is existence (an `fs.stat`), so `app.js`
    // and `app.css` are absent here — which is why an App backing a graph needs no
    // `.js`/image parsers. Every Liquid file in the fixture IS read: the absence above
    // is about assets, not about a build that read nothing.
    expect(indexed.sourcesRead).toEqual(
      [
        pathUtils.join(skeleton, 'app', 'views', 'layouts', 'application.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'pages', 'index.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'child.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'header.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'parent.liquid'),
      ].sort(),
    );
  });
});

describe('a module-prefixed name resolved through an App index', () => {
  let indexed: Build;
  let unindexed: Build;

  beforeAll(async () => {
    indexed = await buildRecording(moduleEdges, wholeApp);
    unindexed = await buildRecording(moduleEdges);
  });

  it('costs no listing at all — this fixture has no assets to except', () => {
    expect(indexed.listedDirectories).toEqual([]);
  });

  it('resolves `modules/my_module/…` to the same files the candidate walk finds', () => {
    expect(canonical(indexed.graph)).toEqual(canonical(unindexed.graph));
  });
});
