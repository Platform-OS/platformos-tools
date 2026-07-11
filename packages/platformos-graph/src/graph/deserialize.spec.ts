import { beforeEach, describe, expect, it } from 'vitest';

import {
  isLayout,
  isPage,
  isPartial,
  path,
  recursiveReadDirectory,
  UriString,
} from '@platformos/platformos-check-common';
import { MockFileSystem, type MockApp } from '@platformos/platformos-check-common/dist/test';

import {
  applyFileChange,
  buildAppGraph,
  deserializeAppGraph,
  dependentsOf,
  serializeAppGraph,
  type AppGraph,
} from '../index';

/**
 * `deserializeAppGraph` is the load half of graph persistence (TASK-9.15 Phase 2).
 * Two contracts matter:
 *  1. ROUND-TRIP: serialize → deserialize → serialize is identity (modulo order).
 *  2. INCREMENTAL-READY: a deserialized graph must behave EXACTLY like a
 *     from-scratch build under `applyFileChange` — i.e. the module identity cache
 *     is seeded, so reconciling a loaded graph converges to the same graph a full
 *     build would produce. This is the guarantee that makes "load a persisted
 *     graph, then reconcile the delta" never-stale.
 *
 * The project source is an in-memory {@link MockFileSystem}; its backing object
 * is mutated to add/modify/delete a file (no disk I/O).
 */
describe('Unit: deserializeAppGraph (persistence load half)', () => {
  const rootUri = path.normalize('file:/');

  let files: MockApp;
  let fs: MockFileSystem;

  const uri = (rel: string): UriString => path.join(rootUri, rel);

  const write = (rel: string, content: string): void => {
    files[rel] = content;
  };
  const remove = (rel: string): void => {
    delete files[rel];
  };

  const entryPoints = (): Promise<UriString[]> =>
    recursiveReadDirectory(fs, rootUri, ([u]) => isLayout(u) || isPage(u) || isPartial(u));

  const buildFull = async (): Promise<AppGraph> =>
    buildAppGraph(rootUri, { fs }, await entryPoints());

  const canonical = (graph: AppGraph) => {
    const serialized = serializeAppGraph(graph);
    return {
      rootUri: serialized.rootUri,
      nodes: [...serialized.nodes].sort((a, b) => a.uri.localeCompare(b.uri)),
      edges: [...serialized.edges].map((edge) => JSON.stringify(edge)).sort(),
    };
  };

  beforeEach(() => {
    files = {
      'app/views/pages/index.liquid': `---
layout: application
---
{% render 'card' %}
{% graphql q = 'get_posts' %}`,
      'app/views/partials/card.liquid': `{% render 'button' %}`,
      'app/views/partials/button.liquid': `<button></button>`,
      'app/views/layouts/application.liquid': `{{ content_for_layout }}`,
      'app/graphql/get_posts.graphql': `query get_posts { records(filter: { table: { value: "blog_post" } }) { results { id } } }`,
    };
    fs = new MockFileSystem(files, rootUri);
  });

  it('round-trips serialize → deserialize → serialize identically', async () => {
    const original = await buildFull();
    const serialized = serializeAppGraph(original);
    const entryPointUris = original.entryPoints.map((module) => module.uri);

    const restored = deserializeAppGraph(serialized, entryPointUris);

    expect(canonical(restored)).toEqual(canonical(original));
    expect(restored.rootUri).toBe(original.rootUri);
    // Entry points are restored (not carried by the serialized form itself).
    expect(restored.entryPoints.map((m) => m.uri).sort()).toEqual(entryPointUris.sort());
  });

  it('rebuilds the reverse index so dependents are queryable on the restored graph', async () => {
    const original = await buildFull();
    const restored = deserializeAppGraph(
      serializeAppGraph(original),
      original.entryPoints.map((module) => module.uri),
    );

    expect(
      dependentsOf(restored, uri('app/views/partials/card.liquid')).map((r) => r.source.uri),
    ).toEqual([uri('app/views/pages/index.liquid')]);
    expect(
      dependentsOf(restored, uri('app/views/partials/button.liquid')).map((r) => r.source.uri),
    ).toEqual([uri('app/views/partials/card.liquid')]);
  });

  it('a restored graph reconciles a change EXACTLY like a from-scratch build (cache is seeded)', async () => {
    const original = await buildFull();
    const restored = deserializeAppGraph(
      serializeAppGraph(original),
      original.entryPoints.map((module) => module.uri),
    );

    // Edit index so it renders button directly, then apply to the RESTORED graph.
    write(
      'app/views/pages/index.liquid',
      `---
layout: application
---
{% render 'card' %}
{% render 'button' %}`,
    );
    await applyFileChange(restored, uri('app/views/pages/index.liquid'), 'modified', { fs });

    // If the identity cache were not seeded, the new edge would bind to a
    // duplicate node and this would diverge from a full build.
    expect(canonical(restored)).toEqual(canonical(await buildFull()));
    expect(
      dependentsOf(restored, uri('app/views/partials/button.liquid'))
        .map((r) => r.source.uri)
        .sort(),
    ).toEqual([uri('app/views/pages/index.liquid'), uri('app/views/partials/card.liquid')]);
  });

  it('reconciles added and deleted files on a restored graph, matching a full build', async () => {
    const original = await buildFull();
    const restored = deserializeAppGraph(
      serializeAppGraph(original),
      original.entryPoints.map((module) => module.uri),
    );

    write('app/views/partials/footer.liquid', '<footer></footer>');
    await applyFileChange(restored, uri('app/views/partials/footer.liquid'), 'added', { fs });

    remove('app/views/pages/index.liquid');
    await applyFileChange(restored, uri('app/views/pages/index.liquid'), 'deleted', { fs });

    expect(canonical(restored)).toEqual(canonical(await buildFull()));
  });

  it('skips dangling edges and restores no entry points when none are given', async () => {
    // A malformed serialization: an edge whose target node is absent.
    const restored = deserializeAppGraph({
      rootUri,
      nodes: [
        { uri: uri('app/views/pages/index.liquid'), type: 'Liquid', kind: 'page', exists: true },
      ],
      edges: [
        {
          source: { uri: uri('app/views/pages/index.liquid') },
          target: { uri: uri('app/views/partials/ghost.liquid') },
          type: 'direct',
          kind: 'render',
        },
      ],
    } as ReturnType<typeof serializeAppGraph>);

    // Dangling edge dropped (target absent) → no half-wired reverse index.
    expect(dependentsOf(restored, uri('app/views/partials/ghost.liquid'))).toEqual([]);
    expect(restored.modules[uri('app/views/pages/index.liquid')]?.dependencies).toEqual([]);
    expect(restored.entryPoints).toEqual([]);
  });
});
