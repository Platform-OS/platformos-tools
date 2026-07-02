import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { path } from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import {
  buildAppGraph,
  type AppGraph,
  dependentsOf,
  type FileChangeKind,
} from '@platformos/platformos-graph';

import { GraphCache } from './graph-cache';

/**
 * A fake graph tagged with a build id so a test can assert WHICH build's graph
 * was returned (the cache treats the graph as opaque).
 */
const fakeGraph = (id: number): AppGraph =>
  ({ rootUri: 'file:///p', entryPoints: [], modules: {}, __build: id }) as unknown as AppGraph;

const fp = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('GraphCache: never-stale, background-built, deduplicated', () => {
  const rootUri = 'file:///p';

  it('does not serve a graph on the first lookup, but triggers a build that a later lookup serves', async () => {
    const buildGraph = vi.fn(async () => fakeGraph(1));
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => fp({ a: '1' }),
      buildGraph,
    });

    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });
    expect(buildGraph).toHaveBeenCalledTimes(1);
  });

  it('reuses the built graph across lookups while the fingerprint is unchanged (one build)', async () => {
    const buildGraph = vi.fn(async () => fakeGraph(1));
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => fp({ a: '1' }),
      buildGraph,
    });

    await cache.lookup();
    await cache.settle();
    await cache.lookup();
    await cache.lookup();

    expect(buildGraph).toHaveBeenCalledTimes(1);
  });

  it('NEVER serves stale: a source change is applied incrementally and served fresh (no rebuild)', async () => {
    let current = fp({ a: '1' });
    const applied: Array<[string, FileChangeKind]> = [];
    const buildGraph = vi.fn(async () => fakeGraph(1));
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => current,
      buildGraph,
      applyChange: async (_graph, uri, kind) => {
        applied.push([uri, kind]);
      },
    });

    await cache.lookup();
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });

    // A source file changed → the graph is updated in place and served immediately.
    current = fp({ a: '2' });
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });
    expect(applied).toEqual([['a', 'modified']]);
    expect(buildGraph).toHaveBeenCalledTimes(1); // updated incrementally, NOT rebuilt
  });

  it('applies added, modified, and deleted files from the fingerprint diff', async () => {
    let current = fp({ a: '1', b: '1' });
    const applied: Array<[string, FileChangeKind]> = [];
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => current,
      buildGraph: async () => fakeGraph(1),
      applyChange: async (_graph, uri, kind) => {
        applied.push([uri, kind]);
      },
    });

    await cache.lookup();
    await cache.settle();

    current = fp({ a: '2', c: '1' }); // a modified, c added, b deleted
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });
    // Diff order: changed/added in `next` insertion order, then deletions.
    expect(applied).toEqual([
      ['a', 'modified'],
      ['c', 'added'],
      ['b', 'deleted'],
    ]);
  });

  it('falls back to a full rebuild when incremental apply fails (never a half-applied graph)', async () => {
    let current = fp({ a: '1' });
    let build = 0;
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => current,
      buildGraph: async () => fakeGraph(++build),
      applyChange: async () => {
        throw new Error('apply boom');
      },
    });

    await cache.lookup();
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });

    // Incremental apply throws → discard the graph and rebuild from scratch.
    current = fp({ a: '2' });
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(2) });
    expect(build).toBe(2);
  });

  it('serializes concurrent reconciliations so the same change is not double-applied', async () => {
    let current = fp({ a: '1' });
    let applyCount = 0;
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => current,
      buildGraph: async () => fakeGraph(1),
      applyChange: async () => {
        applyCount++;
        await Promise.resolve();
      },
    });

    await cache.lookup();
    await cache.settle();

    current = fp({ a: '2' });
    const results = await Promise.all([cache.lookup(), cache.lookup(), cache.lookup()]);
    results.forEach((result) => expect(result).toEqual({ graph: fakeGraph(1) }));
    // First reconcile applies 'a'; the queued ones re-check (already caught up) → no-op.
    expect(applyCount).toBe(1);
  });

  it('reports unavailable when the build fails, without a retry storm for the same source', async () => {
    const buildGraph = vi.fn(async () => {
      throw new Error('boom');
    });
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => fp({ a: '1' }),
      buildGraph,
    });

    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();
    // Same (failed) fingerprint: unavailable, and NOT retried on every call.
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'unavailable' });
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'unavailable' });
    expect(buildGraph).toHaveBeenCalledTimes(1);
  });

  it('retries the build after a failure once the source fingerprint changes', async () => {
    let current = fp({ a: '1' });
    const buildGraph = vi.fn(async () => {
      if (current.get('a') === '1') throw new Error('boom');
      return fakeGraph(2);
    });
    const cache = new GraphCache({ rootUri, computeFingerprint: async () => current, buildGraph });

    await cache.lookup();
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'unavailable' });

    current = fp({ a: '2' }); // project edited (maybe fixed)
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(2) });
    expect(buildGraph).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent lookups into a single in-flight build', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const buildGraph = vi.fn(async () => {
      await gate;
      return fakeGraph(1);
    });
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => fp({ a: '1' }),
      buildGraph,
    });

    // Fire several lookups before the build resolves.
    await Promise.all([cache.lookup(), cache.lookup(), cache.lookup()]);
    release();
    await cache.settle();

    expect(buildGraph).toHaveBeenCalledTimes(1);
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });
  });
});

describe('GraphCache: real project (integration — real buildAppGraph + fs + mtime)', () => {
  let projectDir: string;
  let rootUri: string;
  const write = (rel: string, body: string) => {
    const abs = join(projectDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  const uri = (rel: string) => path.normalize(path.URI.file(join(projectDir, rel)));

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-graphcache-'));
    write('app/views/partials/card.liquid', '<div>{{ title }}</div>');
    write('app/views/pages/index.liquid', "{% render 'card' %}");
    write('app/views/pages/about.liquid', '<h1>About</h1>');
    rootUri = path.normalize(path.URI.file(projectDir));
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  const dependentSources = (graph: AppGraph, rel: string): string[] =>
    dependentsOf(graph, uri(rel))
      .map((ref) => ref.source.uri)
      .sort();

  it('builds a fresh graph whose dependents reflect real callers, and stays fresh incrementally on a source change', async () => {
    const cache = new GraphCache({ rootUri, fs: NodeFileSystem });

    // Cold: no graph yet, build triggered.
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();

    const first = await cache.lookup();
    expect('graph' in first && first.graph).toBeTruthy();
    if (!('graph' in first) || !first.graph) throw new Error('expected a fresh graph');
    // card is rendered by index → index is its sole dependent.
    expect(dependentSources(first.graph, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/index.liquid'),
    ]);

    // Edit a caller so about now also renders card. The cache applies the change
    // incrementally (real applyFileChange) and serves the UPDATED graph
    // immediately — no `recomputing` gap. (A fresh mtime is guaranteed by
    // writing different content.)
    write('app/views/pages/about.liquid', "{% render 'card' %}\n<h1>About</h1>");
    const second = await cache.lookup();
    if (!('graph' in second) || !second.graph) throw new Error('expected an updated graph');
    expect(dependentSources(second.graph, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/about.liquid'),
      uri('app/views/pages/index.liquid'),
    ]);
  }, 20000);
});

describe('GraphCache: persistence (Phase 2 — warm cold-start from disk + reconcile)', () => {
  let projectDir: string;
  let cacheDir: string;
  let cachePath: string;
  let rootUri: string;

  const write = (rel: string, body: string) => {
    const absPath = join(projectDir, rel);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, body, 'utf8');
  };
  const uri = (rel: string) => path.normalize(path.URI.file(join(projectDir, rel)));
  const dependentSources = (graph: AppGraph, rel: string): string[] =>
    dependentsOf(graph, uri(rel))
      .map((ref) => ref.source.uri)
      .sort();
  // A real build, wrapped so a test can spy on whether the graph was rebuilt vs loaded.
  const realBuild = (root: string, fs: typeof NodeFileSystem, entryPoints: string[]) =>
    buildAppGraph(root, { fs }, entryPoints);
  const graphOf = (lookup: Awaited<ReturnType<GraphCache['lookup']>>): AppGraph => {
    if (!('graph' in lookup) || !lookup.graph) throw new Error('expected a graph');
    return lookup.graph;
  };

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-persist-proj-'));
    // The cache file lives OUTSIDE the project so it is never walked as a source.
    cacheDir = mkdtempSync(join(tmpdir(), 'mcp-sup-persist-cache-'));
    cachePath = join(cacheDir, 'graph.json');
    write('app/views/partials/card.liquid', '<div>{{ title }}</div>');
    write('app/views/pages/index.liquid', "{% render 'card' %}");
    rootUri = path.normalize(path.URI.file(projectDir));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('persists after a cold build and warms a fresh instance from disk (no rebuild)', async () => {
    const first = new GraphCache({ rootUri, fs: NodeFileSystem, cachePath });
    await first.lookup();
    await first.settle();
    expect(existsSync(cachePath)).toBe(true); // persisted after the build

    // A brand-new instance (as if the server restarted) must LOAD, not rebuild.
    const buildSpy = vi.fn(realBuild);
    const second = new GraphCache({ rootUri, fs: NodeFileSystem, cachePath, buildGraph: buildSpy });
    expect(await second.lookup()).toEqual({ graph: null, reason: 'recomputing' }); // hydrating
    await second.settle();

    const served = graphOf(await second.lookup());
    expect(dependentSources(served, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/index.liquid'),
    ]);
    expect(buildSpy).not.toHaveBeenCalled(); // loaded from disk, never rebuilt
  });

  it('reconciles the on-disk delta after warming from cache (still never rebuilds)', async () => {
    const first = new GraphCache({ rootUri, fs: NodeFileSystem, cachePath });
    await first.lookup();
    await first.settle();

    // Source changed while "offline": a new page renders card. The warmed instance
    // must reconcile this delta incrementally, not rebuild.
    write('app/views/pages/about.liquid', "{% render 'card' %}");
    const buildSpy = vi.fn(realBuild);
    const second = new GraphCache({ rootUri, fs: NodeFileSystem, cachePath, buildGraph: buildSpy });
    await second.lookup(); // cold → hydrate (load) in background
    await second.settle();

    const served = graphOf(await second.lookup()); // reconciles the `about` delta, serves fresh
    expect(dependentSources(served, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/about.liquid'),
      uri('app/views/pages/index.liquid'),
    ]);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('falls back to a full build when the cache file is corrupt (never a wrong answer)', async () => {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, 'this is not valid json', 'utf8');

    const buildSpy = vi.fn(realBuild);
    const cache = new GraphCache({ rootUri, fs: NodeFileSystem, cachePath, buildGraph: buildSpy });
    await cache.lookup();
    await cache.settle();

    const served = graphOf(await cache.lookup());
    expect(buildSpy).toHaveBeenCalledTimes(1); // corrupt cache → rebuilt
    expect(dependentSources(served, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/index.liquid'),
    ]);
  });
});
