import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { path } from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { type AppGraph, dependentsOf } from '@platformos/platformos-graph';

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

  it('NEVER serves a stale graph: a changed fingerprint yields recomputing, then the rebuilt graph', async () => {
    let current = fp({ a: '1' });
    let build = 0;
    const cache = new GraphCache({
      rootUri,
      computeFingerprint: async () => current,
      buildGraph: async () => fakeGraph(++build),
    });

    await cache.lookup();
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(1) });

    // A source file changed → the old graph must NOT be served.
    current = fp({ a: '2' });
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();
    expect(await cache.lookup()).toEqual({ graph: fakeGraph(2) });
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

  it('builds a fresh graph whose dependents reflect real callers, and rebuilds — never stale — on a source change', async () => {
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

    // Edit a caller so about now also renders card. The cache must NOT serve the
    // stale graph (which shows only index) — it recomputes.
    // (a fresh mtime is guaranteed by writing different content)
    write('app/views/pages/about.liquid', "{% render 'card' %}\n<h1>About</h1>");
    expect(await cache.lookup()).toEqual({ graph: null, reason: 'recomputing' });
    await cache.settle();

    const second = await cache.lookup();
    if (!('graph' in second) || !second.graph) throw new Error('expected a rebuilt graph');
    expect(dependentSources(second.graph, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/about.liquid'),
      uri('app/views/pages/index.liquid'),
    ]);
  }, 20000);
});
