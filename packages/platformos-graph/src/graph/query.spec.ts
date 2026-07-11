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
  nearestModules,
  orphans,
  reachableFrom,
} from './query';
import {
  getGraphQLModuleByUri,
  getLayoutModule,
  getPageModule,
  getPartialModuleByUri,
  getSchemaModule,
} from './module';
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
    // Sorted by URI — `app/assets/*` sorts ahead of `app/views/*`.
    expect(reachableFrom(graph, p('app/views/pages/index.liquid'))).toEqual([
      p('app/assets/app.css'),
      p('app/assets/app.js'),
      p('app/views/layouts/application.liquid'),
      p('app/views/partials/child.liquid'),
      p('app/views/partials/header.liquid'),
      p('app/views/partials/parent.liquid'),
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
  // schema (exists, referenced by nothing, not an entry point — but NOT an orphan)
  let graph: AppGraph;
  let pageUri: string;
  let usedUri: string;
  let orphanUri: string;
  let missingUri: string;
  let schemaUri: string;

  beforeAll(() => {
    graph = { rootUri, entryPoints: [], modules: {} };
    const page = getPageModule(graph, p('app/views/pages/index.liquid'));
    const used = getPartialModuleByUri(graph, p('app/views/partials/used.liquid'));
    const orphan = getPartialModuleByUri(graph, p('app/views/partials/orphan.liquid'));
    const missing = getPartialModuleByUri(graph, p('app/views/partials/missing.liquid'));
    const schema = getSchemaModule(graph, p('app/schema/blog_post.yml'));

    page.exists = true;
    used.exists = true;
    orphan.exists = true;
    missing.exists = false;
    schema.exists = true;

    bind(page, used, { sourceRange: [0, 10], kind: 'render' });
    bind(page, missing, { sourceRange: [11, 21], kind: 'render' });

    graph.entryPoints = [page];
    for (const module of [page, used, orphan, missing, schema]) graph.modules[module.uri] = module;

    pageUri = page.uri;
    usedUri = used.uri;
    orphanUri = orphan.uri;
    missingUri = missing.uri;
    schemaUri = schema.uri;
  });

  it('flags an unreferenced, non-entry-point file as an orphan', () => {
    expect(isOrphan(graph, orphanUri)).toBe(true);
  });

  it('does not flag referenced files, entry points, or missing targets as orphans', () => {
    expect(isOrphan(graph, usedUri)).toBe(false); // referenced by the page
    expect(isOrphan(graph, pageUri)).toBe(false); // entry point
    expect(isOrphan(graph, missingUri)).toBe(false); // missing, not orphan
  });

  it('never flags a schema node as an orphan (referenced by table name, not edges)', () => {
    // Without the guard this would be a false positive: schema exists, is not an
    // entry point, and has zero incoming edges.
    expect(isOrphan(graph, schemaUri)).toBe(false);
  });

  it('orphans() lists exactly the orphan modules (excludes the schema)', () => {
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

describe('Graph queries: nearest-name candidates (did-you-mean)', () => {
  const rootUri = 'file:///app';
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));

  // Partials: header, footer, sidebar (exist). A layout ALSO named "header"
  // (exists) — same name, different category. A graphql op blog/find (exists).
  // Typo targets: partial "headr" and graphql "blog/fnd" (both exists:false).
  let graph: AppGraph;
  let headerUri: string;
  let footerUri: string;
  let sidebarUri: string;
  let headrUri: string;
  let graphqlFindUri: string;
  let graphqlTypoUri: string;

  beforeAll(() => {
    graph = { rootUri, entryPoints: [], modules: {} };
    const page = getPageModule(graph, p('app/views/pages/index.liquid'));
    const header = getPartialModuleByUri(graph, p('app/views/partials/header.liquid'));
    const footer = getPartialModuleByUri(graph, p('app/views/partials/footer.liquid'));
    const sidebar = getPartialModuleByUri(graph, p('app/views/partials/sidebar.liquid'));
    const headerLayout = getLayoutModule(graph, p('app/views/layouts/header.liquid'))!;
    const find = getGraphQLModuleByUri(graph, p('app/graphql/blog/find.graphql'));
    const headr = getPartialModuleByUri(graph, p('app/views/partials/headr.liquid'));
    const graphqlTypo = getGraphQLModuleByUri(graph, p('app/graphql/blog/fnd.graphql'));

    for (const m of [page, header, footer, sidebar, headerLayout, find]) m.exists = true;
    headr.exists = false;
    graphqlTypo.exists = false;

    graph.entryPoints = [page];
    for (const m of [page, header, footer, sidebar, headerLayout, find, headr, graphqlTypo]) {
      graph.modules[m.uri] = m;
    }

    headerUri = header.uri;
    footerUri = footer.uri;
    sidebarUri = sidebar.uri;
    headrUri = headr.uri;
    graphqlFindUri = find.uri;
    graphqlTypoUri = graphqlTypo.uri;
  });

  it('ranks the closest same-category name first', () => {
    expect(nearestModules(graph, headrUri, { limit: 1 }).map((m) => m.uri)).toEqual([headerUri]);
  });

  it('only considers existing modules of the same category (excludes self, layouts, graphql, missing)', () => {
    // The layout "header" shares the name but is a different kind; the graphql
    // op, the page, the typo itself, and missing modules are all out.
    const uris = nearestModules(graph, headrUri, { limit: 10 })
      .map((m) => m.uri)
      .sort((a, b) => a.localeCompare(b));
    expect(uris).toEqual([footerUri, headerUri, sidebarUri]);
  });

  it('honours maxDistance', () => {
    // Only "header" is within edit distance 1 of "headr".
    expect(nearestModules(graph, headrUri, { maxDistance: 1 }).map((m) => m.uri)).toEqual([
      headerUri,
    ]);
  });

  it('suggests graphql operations for a missing graphql target', () => {
    expect(nearestModules(graph, graphqlTypoUri, { limit: 1 }).map((m) => m.uri)).toEqual([
      graphqlFindUri,
    ]);
  });

  it('returns [] for a URI absent from the graph', () => {
    expect(nearestModules(graph, p('app/views/partials/unknown.liquid'))).toEqual([]);
  });
});
