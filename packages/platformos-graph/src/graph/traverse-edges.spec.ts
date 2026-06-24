import { path as pathUtils } from '@platformos/platformos-check-common';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import { AppGraph, Dependencies, LiquidModuleKind, ModuleType } from '../types';
import { fixturesRoot, getDependencies } from './test-helpers';

/**
 * Edge-kind coverage for the non-render dependency edges added in TASK-9.1.
 * Each fixture is a tiny isolated project under `fixtures/`.
 */
describe('Module: traverse — function-call edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'function-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  let dependencies: Dependencies;
  let graph: AppGraph;

  beforeAll(async () => {
    dependencies = await getDependencies(rootUri);
    graph = await buildAppGraph(rootUri, dependencies);
  }, 15000);

  it('creates a function edge from a page to the resolved lib query', () => {
    const page = graph.modules[p('app/views/pages/index.liquid')];
    assert(page);

    const fnEdge = page.dependencies.find((d) => d.target.uri === p('app/lib/queries/list.liquid'));
    assert(fnEdge);
    expect(fnEdge.kind).toBe('function');
  });

  it('makes the called query a first-class module that exists and is referenced', () => {
    const query = graph.modules[p('app/lib/queries/list.liquid')];
    assert(query);
    assert(query.type === ModuleType.Liquid);
    assert(query.kind === LiquidModuleKind.Partial);
    expect(query.exists).toBe(true);
    expect(query.references.map((r) => r.source.uri)).toContain(p('app/views/pages/index.liquid'));
  });

  it('records a missing function target as a node with exists:false', () => {
    const missing = graph.modules[p('app/lib/queries/missing.liquid')];
    assert(missing);
    expect(missing.exists).toBe(false);
  });
});

describe('Module: traverse — graphql edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'graphql-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  let dependencies: Dependencies;
  let graph: AppGraph;

  beforeAll(async () => {
    dependencies = await getDependencies(rootUri);
    graph = await buildAppGraph(rootUri, dependencies);
  }, 15000);

  it('creates a graphql edge from a page to the resolved .graphql operation', () => {
    const page = graph.modules[p('app/views/pages/index.liquid')];
    assert(page);

    const gqlEdge = page.dependencies.find(
      (d) => d.target.uri === p('app/graphql/blog_posts/find.graphql'),
    );
    assert(gqlEdge);
    expect(gqlEdge.kind).toBe('graphql');
  });

  it('makes the operation a first-class GraphQL module that exists and is referenced', () => {
    const op = graph.modules[p('app/graphql/blog_posts/find.graphql')];
    assert(op);
    expect(op.type).toBe(ModuleType.GraphQL);
    expect(op.exists).toBe(true);
    expect(op.references.map((r) => r.source.uri)).toContain(p('app/views/pages/index.liquid'));
  });

  it('records a missing graphql target as a node with exists:false', () => {
    const missing = graph.modules[p('app/graphql/blog_posts/missing.graphql')];
    assert(missing);
    expect(missing.exists).toBe(false);
  });
});

describe('Module: traverse — include edges', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'include-edges');
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  let dependencies: Dependencies;
  let graph: AppGraph;

  beforeAll(async () => {
    dependencies = await getDependencies(rootUri);
    graph = await buildAppGraph(rootUri, dependencies);
  }, 15000);

  it('tags {% include %} edges with kind "include" (distinct from render)', () => {
    const page = graph.modules[p('app/views/pages/index.liquid')];
    assert(page);

    const includeEdge = page.dependencies.find(
      (d) => d.target.uri === p('app/views/partials/shared/header.liquid'),
    );
    assert(includeEdge);
    expect(includeEdge.kind).toBe('include');
  });
});
