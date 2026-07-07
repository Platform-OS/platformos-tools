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
  dependentsOf,
  serializeAppGraph,
  type AppGraph,
  type FileChangeKind,
} from '../index';

/**
 * TASK-9.14: `applyFileChange` updates a built graph in place for one file's
 * change WITHOUT a full rebuild.
 *
 * The load-bearing contract (a wrong incremental result would mislead the agent)
 * is EQUIVALENCE-TO-FULL-BUILD: after applying any change (or sequence), the
 * graph must equal a from-scratch `buildAppGraph` of the same final source state.
 * Each scenario mutates an in-memory {@link MockFileSystem} (its backing object
 * is mutated to add/modify/delete a file — no disk I/O), applies the change, and
 * asserts the incrementally-updated graph serializes identically to a fresh full
 * build — the same guarantee across add / modify / delete, missing targets,
 * leaf GC, self-reference, and cycles.
 */
describe('Unit: applyFileChange (incremental graph update)', () => {
  const rootUri = path.normalize('file:/');

  let files: MockApp;
  let fs: MockFileSystem;

  /** Normalized `file://` URI for a project-relative path (matches graph node keys). */
  const uri = (rel: string): UriString => path.join(rootUri, rel);

  /** Add or overwrite a file in the mock's backing store (reflected live by `fs`). */
  const write = (rel: string, content: string): void => {
    files[rel] = content;
  };
  /** Remove a file from the mock's backing store. */
  const remove = (rel: string): void => {
    delete files[rel];
  };

  /** The edge-source liquid files — the cache's build entry points. */
  const entryPoints = (): Promise<UriString[]> =>
    recursiveReadDirectory(fs, rootUri, ([u]) => isLayout(u) || isPage(u) || isPartial(u));

  /** A from-scratch full build over the current source state (the reference graph). */
  const buildFull = async (): Promise<AppGraph> =>
    buildAppGraph(rootUri, { fs }, await entryPoints());

  /** Canonical, order-independent serialization for whole-graph equality. */
  const canonical = (graph: AppGraph) => {
    const serialized = serializeAppGraph(graph);
    return {
      rootUri: serialized.rootUri,
      nodes: [...serialized.nodes].sort((a, b) => a.uri.localeCompare(b.uri)),
      edges: [...serialized.edges].map((edge) => JSON.stringify(edge)).sort(),
    };
  };

  /** The incremental graph must serialize identically to a fresh full build. */
  const expectEquivalentToFullBuild = async (incremental: AppGraph): Promise<void> => {
    expect(canonical(incremental)).toEqual(canonical(await buildFull()));
  };

  const change = (rel: string, kind: FileChangeKind, graph: AppGraph): Promise<void> =>
    applyFileChange(graph, uri(rel), kind, { fs });

  const GET_POSTS_GRAPHQL = `query get_posts {
  records(per_page: 20, filter: { table: { value: "blog_post" } }) {
    results { id }
  }
}
`;

  beforeEach(() => {
    // A small but representative project: a page with a layout, a render chain,
    // and a graphql leaf.
    files = {
      'app/views/pages/index.liquid': `---
layout: application
---
{% render 'card' %}
{% graphql q = 'get_posts' %}`,
      'app/views/partials/card.liquid': `{% render 'button' %}`,
      'app/views/partials/button.liquid': `<button></button>`,
      'app/views/layouts/application.liquid': `{{ content_for_layout }}`,
      'app/graphql/get_posts.graphql': GET_POSTS_GRAPHQL,
    };
    fs = new MockFileSystem(files, rootUri);
  });

  it('MODIFIED: adds a new edge to an existing partial', async () => {
    const graph = await buildFull();

    write(
      'app/views/pages/index.liquid',
      `---
layout: application
---
{% render 'card' %}
{% render 'button' %}`,
    );
    await change('app/views/pages/index.liquid', 'modified', graph);

    await expectEquivalentToFullBuild(graph);
    expect(
      dependentsOf(graph, uri('app/views/partials/button.liquid')).map((r) => r.source.uri),
    ).toEqual([uri('app/views/partials/card.liquid'), uri('app/views/pages/index.liquid')]);
  });

  it('MODIFIED: removing the last edge to a graphql leaf garbage-collects it', async () => {
    const graph = await buildFull();
    expect(graph.modules[uri('app/graphql/get_posts.graphql')]).toBeDefined();

    write(
      'app/views/pages/index.liquid',
      `---
layout: application
---
{% render 'card' %}`,
    );
    await change('app/views/pages/index.liquid', 'modified', graph);

    expect(graph.modules[uri('app/graphql/get_posts.graphql')]).toBeUndefined();
    await expectEquivalentToFullBuild(graph);
  });

  it('MODIFIED: an existing partial that loses its only referrer stays (it is an entry point)', async () => {
    const graph = await buildFull();

    write('app/views/partials/card.liquid', '<div>no more button</div>');
    await change('app/views/partials/card.liquid', 'modified', graph);

    // button.liquid is an edge-source file → an entry point → kept as an orphan.
    expect(graph.modules[uri('app/views/partials/button.liquid')]).toBeDefined();
    expect(dependentsOf(graph, uri('app/views/partials/button.liquid'))).toEqual([]);
    await expectEquivalentToFullBuild(graph);
  });

  it('MODIFIED: refreshes a newly-reached graphql leaf table fact', async () => {
    // Start with a page that references no graphql, then add the graphql edge.
    write('app/views/pages/index.liquid', `{% render 'card' %}`);
    const graph = await buildFull();
    expect(graph.modules[uri('app/graphql/get_posts.graphql')]).toBeUndefined();

    write(
      'app/views/pages/index.liquid',
      `{% render 'card' %}
{% graphql q = 'get_posts' %}`,
    );
    await change('app/views/pages/index.liquid', 'modified', graph);

    const full = await buildFull();
    const node = graph.modules[uri('app/graphql/get_posts.graphql')];
    const fullNode = full.modules[uri('app/graphql/get_posts.graphql')];
    expect(node?.type).toBe(fullNode?.type);
    expect((node as { tables?: string[] }).tables).toEqual(
      (fullNode as { tables?: string[] }).tables,
    );
    await expectEquivalentToFullBuild(graph);
  });

  it('ADDED: a brand-new partial (edge source) becomes a materialized entry point', async () => {
    const graph = await buildFull();

    write('app/views/partials/footer.liquid', '<footer></footer>');
    await change('app/views/partials/footer.liquid', 'added', graph);

    expect(graph.modules[uri('app/views/partials/footer.liquid')]?.exists).toBe(true);
    await expectEquivalentToFullBuild(graph);
  });

  it('ADDED: a previously-missing render target flips exists and resolves its incoming edge', async () => {
    // index renders a partial that does not exist yet.
    write(
      'app/views/pages/index.liquid',
      `---
layout: application
---
{% render 'ghost' %}`,
    );
    const graph = await buildFull();
    const ghost = uri('app/views/partials/ghost.liquid');
    expect(graph.modules[ghost]?.exists).toBe(false);

    write('app/views/partials/ghost.liquid', '<div>ghost</div>');
    await change('app/views/partials/ghost.liquid', 'added', graph);

    expect(graph.modules[ghost]?.exists).toBe(true);
    // The incoming edge from index resolves automatically once exists flips.
    expect(dependentsOf(graph, ghost).map((r) => r.source.uri)).toEqual([
      uri('app/views/pages/index.liquid'),
    ]);
    await expectEquivalentToFullBuild(graph);
  });

  it('DELETED: a still-referenced file survives as a known-missing target', async () => {
    const graph = await buildFull();

    remove('app/views/partials/button.liquid');
    await change('app/views/partials/button.liquid', 'deleted', graph);

    const button = graph.modules[uri('app/views/partials/button.liquid')];
    // card still renders it → node kept, marked missing.
    expect(button?.exists).toBe(false);
    expect(
      dependentsOf(graph, uri('app/views/partials/button.liquid')).map((r) => r.source.uri),
    ).toEqual([uri('app/views/partials/card.liquid')]);
    await expectEquivalentToFullBuild(graph);
  });

  it('DELETED: an unreferenced file is removed entirely, GC-ing its now-orphaned leaves', async () => {
    const graph = await buildFull();
    expect(graph.modules[uri('app/graphql/get_posts.graphql')]).toBeDefined();

    // index is the only referrer of the layout and the graphql op; nothing renders index.
    remove('app/views/pages/index.liquid');
    await change('app/views/pages/index.liquid', 'deleted', graph);

    expect(graph.modules[uri('app/views/pages/index.liquid')]).toBeUndefined();
    expect(graph.modules[uri('app/graphql/get_posts.graphql')]).toBeUndefined();
    await expectEquivalentToFullBuild(graph);
  });

  it('handles a self-referencing file', async () => {
    write('app/views/partials/card.liquid', `{% render 'card' %}`);
    const graph = await buildFull();

    // Modify it to no longer reference itself, then back — both must stay equivalent.
    write('app/views/partials/card.liquid', '<div>plain</div>');
    await change('app/views/partials/card.liquid', 'modified', graph);
    await expectEquivalentToFullBuild(graph);

    write('app/views/partials/card.liquid', `{% render 'card' %}`);
    await change('app/views/partials/card.liquid', 'modified', graph);
    await expectEquivalentToFullBuild(graph);
  });

  it('handles a cycle (A renders B, B renders A)', async () => {
    write('app/views/partials/a.liquid', `{% render 'b' %}`);
    write('app/views/partials/b.liquid', `{% render 'a' %}`);
    const graph = await buildFull();

    write('app/views/partials/a.liquid', '<div>no more b</div>');
    await change('app/views/partials/a.liquid', 'modified', graph);

    await expectEquivalentToFullBuild(graph);
  });

  it('stays equivalent across a mixed sequence of changes', async () => {
    const graph = await buildFull();

    // add a partial, wire the page to it, delete another, edit the layout.
    write('app/views/partials/footer.liquid', '<footer></footer>');
    await change('app/views/partials/footer.liquid', 'added', graph);

    write(
      'app/views/pages/index.liquid',
      `---
layout: application
---
{% render 'card' %}
{% render 'footer' %}`,
    );
    await change('app/views/pages/index.liquid', 'modified', graph);

    remove('app/graphql/get_posts.graphql');
    // get_posts is no longer referenced by index (removed above) so it is already
    // gone; deleting a file the graph does not model is a safe no-op.
    await change('app/graphql/get_posts.graphql', 'deleted', graph);

    write('app/views/layouts/application.liquid', '<html>{{ content_for_layout }}</html>');
    await change('app/views/layouts/application.liquid', 'modified', graph);

    await expectEquivalentToFullBuild(graph);
  });

  it('is a no-op for a file the graph does not model (schema / unclassified)', async () => {
    const graph = await buildFull();
    const before = canonical(graph);

    await change('app/schema/blog_post.yml', 'modified', graph);
    await change('app/schema/blog_post.yml', 'added', graph);
    await change('app/schema/blog_post.yml', 'deleted', graph);

    expect(canonical(graph)).toEqual(before);
  });
});
