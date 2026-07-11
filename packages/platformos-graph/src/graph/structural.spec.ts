import { path as pathUtils } from '@platformos/platformos-check-common';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { buildAppGraph, extractStructural, toSourceCode } from '../index';
import { AppGraph, LiquidModule, ModuleStructural, ModuleType } from '../types';
import { getDependencies, fixturesRoot } from './test-helpers';

/**
 * TASK-9.3 (+ code-review F1): a Liquid file's own structural declarations.
 *
 * `extractStructural` is the per-file primitive (sibling to
 * `extractFileReferences`). A full `buildAppGraph` populates
 * `LiquidModule.structural` from it ONLY when `{ includeStructural: true }` is
 * passed — the opt-in that keeps a full build (e.g. the LSP's) from computing a
 * fact nothing reads.
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

describe('extractStructural: the per-file primitive', () => {
  const rootUri = pathUtils.join(fixturesRoot, 'structural');
  const uriOf = (part: string) => URI.file(pathUtils.join(rootUri, ...part.split('/'))).toString();

  const run = async (part: string, content: string): Promise<ModuleStructural | undefined> => {
    const uri = uriOf(part);
    return extractStructural(await toSourceCode(uri, content), uri);
  };

  it('extracts usage + routing facts from an in-flight buffer (no graph build)', async () => {
    const content = `---
layout: theme
method: post
---
{% render 'card' %}
{{ 'greeting.hi' | t }}
{{ title | upcase }}`;
    expect(await run('app/views/pages/contact.liquid', content)).toEqual({
      renders_used: ['card'],
      graphql_queries_used: [],
      filters_used: ['t', 'upcase'],
      tags_used: ['render'],
      translation_keys: ['greeting.hi'],
      doc_params: [],
      slug: 'contact',
      layout: 'theme',
      method: 'post',
    });
  });

  it('returns undefined for a non-Liquid (.graphql) buffer', async () => {
    expect(await run('app/graphql/find.graphql', 'query find { records { id } }')).toBeUndefined();
  });
});
