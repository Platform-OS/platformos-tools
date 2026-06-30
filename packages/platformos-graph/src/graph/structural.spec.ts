import { path as pathUtils } from '@platformos/platformos-check-common';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import { AppGraph, LiquidModule, ModuleStructural, ModuleType } from '../types';
import { getDependencies, fixturesRoot } from './test-helpers';

/**
 * TASK-9.3: a Liquid file's own structural declarations surfaced on its module
 * as a by-product of the graph's parse, so a consumer never re-parses the file.
 * Phase A: page routing facts (slug/layout/method). Phase B: AST usage facts
 * (renders/graphql/filters/tags/translation_keys), always present (empty = none).
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
    graph = await buildAppGraph(rootUri, getDependencies());
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
