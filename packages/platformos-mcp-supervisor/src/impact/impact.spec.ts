import { describe, expect, it } from 'vitest';

import type { AppGraph, Reference } from '@platformos/platformos-graph';

import { runImpact } from './impact';
import type { GraphCache } from '../graph-cache/graph-cache';

const PROJECT = '/project';
const u = (rel: string) => `file://${PROJECT}/${rel}`;

/** A graph in which `fileRel` has the given incoming reference edges (with optional passed args). */
function graphWithDependents(
  fileRel: string,
  refs: { source: string; kind: Reference['kind']; args?: string[] }[],
): AppGraph {
  const references: Reference[] = refs.map(({ source, kind, args }) => ({
    source: { uri: u(source) },
    target: { uri: u(fileRel) },
    type: 'direct',
    kind,
    ...(args ? { args } : {}),
  }));
  return {
    rootUri: u(''),
    entryPoints: [],
    modules: { [u(fileRel)]: { references } },
  } as unknown as AppGraph;
}

/** A GraphCache stub returning a fixed lookup result (runImpact only calls lookup). */
const stubCache = (result: Awaited<ReturnType<GraphCache['lookup']>>): GraphCache =>
  ({ lookup: async () => result }) as unknown as GraphCache;

const run = (fileRel: string, cache: GraphCache, content = '') =>
  runImpact({ projectDir: PROJECT, filePath: fileRel, content }, cache);

describe('runImpact: blast radius from the cached graph', () => {
  const card = 'app/views/partials/card.liquid';

  it('summarizes distinct dependent files, per-kind counts, and a sorted sample when computed', async () => {
    const graph = graphWithDependents(card, [
      { source: 'app/views/pages/index.liquid', kind: 'render' },
      { source: 'app/views/pages/about.liquid', kind: 'render' },
      { source: 'app/views/partials/wrapper.liquid', kind: 'include' },
    ]);

    expect(await run(card, stubCache({ graph }))).toEqual({
      scope: 'direct',
      status: 'computed',
      dependents: {
        total: 3,
        by_kind: { render: 2, include: 1 },
        sample: [
          'app/views/pages/about.liquid',
          'app/views/pages/index.liquid',
          'app/views/partials/wrapper.liquid',
        ],
      },
    });
  });

  it('reports computed with zero dependents (safe to change), distinct from "not computed"', async () => {
    const graph = graphWithDependents(card, []);
    expect(await run(card, stubCache({ graph }))).toEqual({
      scope: 'direct',
      status: 'computed',
      dependents: { total: 0, by_kind: {}, sample: [] },
    });
  });

  it('counts a file once in total but under each kind it references by', async () => {
    const graph = graphWithDependents(card, [
      // same caller, two render edges → one distinct file
      { source: 'app/views/pages/index.liquid', kind: 'render' },
      { source: 'app/views/pages/index.liquid', kind: 'render' },
      // a caller that both renders and includes → one file, counted in both kinds
      { source: 'app/views/partials/dual.liquid', kind: 'render' },
      { source: 'app/views/partials/dual.liquid', kind: 'include' },
    ]);

    expect(await run(card, stubCache({ graph }))).toEqual({
      scope: 'direct',
      status: 'computed',
      dependents: {
        total: 2,
        by_kind: { render: 2, include: 1 },
        sample: ['app/views/pages/index.liquid', 'app/views/partials/dual.liquid'],
      },
    });
  });

  it('caps the sample at 10 files while keeping the true total', async () => {
    const refs = Array.from({ length: 15 }, (_, i) => ({
      source: `app/views/pages/p${String(i).padStart(2, '0')}.liquid`,
      kind: 'render' as const,
    }));
    const result = await run(card, stubCache({ graph: graphWithDependents(card, refs) }));

    expect(result.status).toEqual('computed');
    expect(result.dependents.total).toEqual(15);
    expect(result.dependents.sample).toEqual([
      'app/views/pages/p00.liquid',
      'app/views/pages/p01.liquid',
      'app/views/pages/p02.liquid',
      'app/views/pages/p03.liquid',
      'app/views/pages/p04.liquid',
      'app/views/pages/p05.liquid',
      'app/views/pages/p06.liquid',
      'app/views/pages/p07.liquid',
      'app/views/pages/p08.liquid',
      'app/views/pages/p09.liquid',
    ]);
  });

  it('reports status "computing" (zeroed) when the graph is not yet fresh — never a stale answer', async () => {
    expect(await run(card, stubCache({ graph: null, reason: 'recomputing' }))).toEqual({
      scope: 'direct',
      status: 'computing',
      dependents: { total: 0, by_kind: {}, sample: [] },
    });
  });

  it('reports status "unavailable" (zeroed) when the graph could not be built', async () => {
    expect(await run(card, stubCache({ graph: null, reason: 'unavailable' }))).toEqual({
      scope: 'direct',
      status: 'unavailable',
      dependents: { total: 0, by_kind: {}, sample: [] },
    });
  });
});

describe('runImpact: signature-impact (callers vs the edited buffer {% doc %})', () => {
  const card = 'app/views/partials/card.liquid';

  // A buffer declaring `title` (required) and `count` (optional).
  const docBuffer = `{% doc %}
  @param {String} title - required title
  @param {Number} [count] - optional count
{% enddoc %}
<div>{{ title }}</div>`;

  it('flags dependent callers that omit a required @param or pass an undeclared one', async () => {
    const graph = graphWithDependents(card, [
      // ok: passes the required title
      { source: 'app/views/pages/ok.liquid', kind: 'render', args: ['title', 'count'] },
      // missing required `title`
      { source: 'app/views/pages/missing.liquid', kind: 'render', args: ['count'] },
      // passes an argument the doc does not declare
      { source: 'app/views/pages/extra.liquid', kind: 'render', args: ['title', 'colour'] },
      // passes nothing at all → missing required `title`
      { source: 'app/views/pages/bare.liquid', kind: 'render' },
    ]);

    const result = await run(card, stubCache({ graph }), docBuffer);

    expect(result.status).toEqual('computed');
    expect(result.signature_risk).toEqual([
      { caller: 'app/views/pages/bare.liquid', missing_required: ['title'], unexpected_args: [] },
      { caller: 'app/views/pages/extra.liquid', missing_required: [], unexpected_args: ['colour'] },
      {
        caller: 'app/views/pages/missing.liquid',
        missing_required: ['title'],
        unexpected_args: [],
      },
    ]);
  });

  it('returns an empty signature_risk (checked, all match) when every caller satisfies the doc', async () => {
    const graph = graphWithDependents(card, [
      { source: 'app/views/pages/a.liquid', kind: 'render', args: ['title'] },
      { source: 'app/views/pages/b.liquid', kind: 'render', args: ['title', 'count'] },
    ]);

    const result = await run(card, stubCache({ graph }), docBuffer);
    expect(result.signature_risk).toEqual([]);
  });

  it('omits signature_risk entirely when the buffer declares no {% doc %} contract', async () => {
    const graph = graphWithDependents(card, [
      { source: 'app/views/pages/x.liquid', kind: 'render', args: ['whatever'] },
    ]);

    const result = await run(card, stubCache({ graph }), '<div>{{ title }}</div>');
    expect(result.signature_risk).toBeUndefined();
    expect(result.status).toEqual('computed');
  });

  it('does not compute signature_risk when the graph is not fresh', async () => {
    const result = await run(card, stubCache({ graph: null, reason: 'recomputing' }), docBuffer);
    expect(result.signature_risk).toBeUndefined();
    expect(result.status).toEqual('computing');
  });
});
