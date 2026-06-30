import { path as pathUtils } from '@platformos/platformos-check-common';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import { AppGraph } from '../types';
import {
  dependenciesOf,
  dependentsOf,
  exists,
  isEntryPoint,
  isOrphan,
  missingDependencies,
  missingTargets,
  orphans,
  reachableFrom,
} from './query';
import { getPageModule, getPartialModule } from './module';
import { bind } from './traverse';
import { getDependencies, skeleton } from './test-helpers';

const targets = (refs: { target: { uri: string } }[]) =>
  refs.map((r) => r.target.uri).sort((a, b) => a.localeCompare(b));
const sources = (refs: { source: { uri: string } }[]) =>
  refs.map((r) => r.source.uri).sort((a, b) => a.localeCompare(b));

describe('Graph queries: over the built skeleton app graph', () => {
  const p = (part: string) => pathUtils.join(skeleton, ...part.split('/'));
  let graph: AppGraph;

  beforeAll(async () => {
    graph = await buildAppGraph(skeleton, getDependencies());
  }, 15000);

  it('dependenciesOf returns a file’s outgoing targets', () => {
    expect(targets(dependenciesOf(graph, p('app/views/pages/index.liquid')))).toEqual([
      p('app/views/layouts/application.liquid'),
      p('app/views/partials/parent.liquid'),
    ]);
  });

  it('dependency edges are call sites carrying kind + named-argument names', () => {
    // index.liquid: `layout: application` (no args) + `{% render "parent", children: "hello" %}`.
    const edges = dependenciesOf(graph, p('app/views/pages/index.liquid'))
      .map((ref) => ({ kind: ref.kind, target: ref.target.uri, args: ref.args }))
      .sort((a, b) => a.target.localeCompare(b.target));

    expect(edges).toEqual([
      { kind: 'layout', target: p('app/views/layouts/application.liquid'), args: undefined },
      { kind: 'render', target: p('app/views/partials/parent.liquid'), args: ['children'] },
    ]);
  });

  it('dependentsOf returns every caller of a file', () => {
    expect(sources(dependentsOf(graph, p('app/views/partials/child.liquid')))).toEqual([
      p('app/views/partials/header.liquid'),
      p('app/views/partials/parent.liquid'),
    ]);
    expect(sources(dependentsOf(graph, p('app/views/layouts/application.liquid')))).toEqual([
      p('app/views/pages/index.liquid'),
    ]);
  });

  it('dependenciesOf / dependentsOf return [] for a URI absent from the graph', () => {
    expect(dependenciesOf(graph, p('app/views/partials/nope.liquid'))).toEqual([]);
    expect(dependentsOf(graph, p('app/views/partials/nope.liquid'))).toEqual([]);
  });

  it('reachableFrom returns the transitive outgoing closure', () => {
    expect(reachableFrom(graph, p('app/views/pages/index.liquid'))).toEqual([
      p('app/views/layouts/application.liquid'),
      p('app/views/partials/child.liquid'),
      p('app/views/partials/header.liquid'),
      p('app/views/partials/parent.liquid'),
      p('assets/app.css'),
      p('assets/app.js'),
    ]);
  });

  it('exists reflects on-disk presence', () => {
    expect(exists(graph, p('app/views/partials/child.liquid'))).toBe(true);
    expect(exists(graph, p('app/views/partials/nope.liquid'))).toBe(false);
  });

  it('isEntryPoint distinguishes pages/layouts from partials', () => {
    expect(isEntryPoint(graph, p('app/views/pages/index.liquid'))).toBe(true);
    expect(isEntryPoint(graph, p('app/views/layouts/application.liquid'))).toBe(true);
    expect(isEntryPoint(graph, p('app/views/partials/child.liquid'))).toBe(false);
  });

  it('a fully-wired skeleton has no orphans and no missing targets', () => {
    expect(orphans(graph)).toEqual([]);
    expect(missingTargets(graph)).toEqual([]);
  });
});

describe('Graph queries: orphan and missing-target detection (hermetic graph)', () => {
  const rootUri = 'file:///app';
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  // page (entry) ─render→ used (exists)
  //                └─render→ missing (exists:false)
  // orphan (exists, referenced by nothing, not an entry point)
  let graph: AppGraph;
  let pageUri: string;
  let usedUri: string;
  let orphanUri: string;
  let missingUri: string;

  beforeAll(() => {
    graph = { rootUri, entryPoints: [], modules: {} };
    const page = getPageModule(graph, p('app/views/pages/index.liquid'));
    const used = getPartialModule(graph, 'used');
    const orphan = getPartialModule(graph, 'orphan');
    const missing = getPartialModule(graph, 'missing');

    page.exists = true;
    used.exists = true;
    orphan.exists = true;
    missing.exists = false;

    bind(page, used, { sourceRange: [0, 10], kind: 'render' });
    bind(page, missing, { sourceRange: [11, 21], kind: 'render' });

    graph.entryPoints = [page];
    for (const module of [page, used, orphan, missing]) graph.modules[module.uri] = module;

    pageUri = page.uri;
    usedUri = used.uri;
    orphanUri = orphan.uri;
    missingUri = missing.uri;
  });

  it('flags an unreferenced, non-entry-point file as an orphan', () => {
    expect(isOrphan(graph, orphanUri)).toBe(true);
  });

  it('does not flag referenced files, entry points, or missing targets as orphans', () => {
    expect(isOrphan(graph, usedUri)).toBe(false); // referenced by the page
    expect(isOrphan(graph, pageUri)).toBe(false); // entry point
    expect(isOrphan(graph, missingUri)).toBe(false); // missing, not orphan
  });

  it('orphans() lists exactly the orphan modules', () => {
    expect(orphans(graph).map((m) => m.uri)).toEqual([orphanUri]);
  });

  it('missingDependencies returns a file’s edges to non-existent targets', () => {
    expect(missingDependencies(graph, pageUri)).toEqual([
      {
        source: { uri: pageUri, range: [11, 21] },
        target: { uri: missingUri },
        type: 'direct',
        kind: 'render',
      },
    ]);
  });

  it('missingTargets lists every unresolved edge in the graph', () => {
    expect(missingTargets(graph)).toEqual([
      {
        source: { uri: pageUri, range: [11, 21] },
        target: { uri: missingUri },
        type: 'direct',
        kind: 'render',
      },
    ]);
  });
});
