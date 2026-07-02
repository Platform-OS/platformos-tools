import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { URI } from 'vscode-uri';

import {
  isLayout,
  isPage,
  isPartial,
  path,
  recursiveReadDirectory,
  UriString,
} from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';

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
 */
describe('Unit: deserializeAppGraph (persistence load half)', () => {
  let root: string;
  let rootUri: UriString;

  const deps = { fs: NodeFileSystem };
  const abs = (rel: string) => nodePath.join(root, ...rel.split('/'));
  const uri = (rel: string): UriString => path.normalize(URI.file(abs(rel)).toString());

  async function write(rel: string, content: string): Promise<void> {
    const file = abs(rel);
    await mkdir(nodePath.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }

  async function entryPoints(): Promise<UriString[]> {
    return recursiveReadDirectory(
      NodeFileSystem,
      rootUri,
      ([u]) => isLayout(u) || isPage(u) || isPartial(u),
    );
  }

  async function buildFull(): Promise<AppGraph> {
    return buildAppGraph(rootUri, deps, await entryPoints());
  }

  function canonical(graph: AppGraph) {
    const serialized = serializeAppGraph(graph);
    return {
      rootUri: serialized.rootUri,
      nodes: [...serialized.nodes].sort((a, b) => a.uri.localeCompare(b.uri)),
      edges: [...serialized.edges].map((edge) => JSON.stringify(edge)).sort(),
    };
  }

  beforeEach(async () => {
    root = await mkdtemp(nodePath.join(tmpdir(), 'pos-graph-deserialize-'));
    rootUri = path.normalize(URI.file(root).toString());

    await write(
      'app/views/pages/index.liquid',
      [
        '---',
        'layout: application',
        '---',
        "{% render 'card' %}",
        "{% graphql q = 'get_posts' %}",
      ].join('\n'),
    );
    await write('app/views/partials/card.liquid', "{% render 'button' %}");
    await write('app/views/partials/button.liquid', '<button></button>');
    await write('app/views/layouts/application.liquid', '{{ content_for_layout }}');
    await write(
      'app/graphql/get_posts.graphql',
      'query get_posts { records(filter: { table: { value: "blog_post" } }) { results { id } } }',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
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
    await write(
      'app/views/pages/index.liquid',
      ['---', 'layout: application', '---', "{% render 'card' %}", "{% render 'button' %}"].join(
        '\n',
      ),
    );
    await applyFileChange(restored, uri('app/views/pages/index.liquid'), 'modified', deps);

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

    await write('app/views/partials/footer.liquid', '<footer></footer>');
    await applyFileChange(restored, uri('app/views/partials/footer.liquid'), 'added', deps);

    await rm(abs('app/views/pages/index.liquid'));
    await applyFileChange(restored, uri('app/views/pages/index.liquid'), 'deleted', deps);

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
