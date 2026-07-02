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
} from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { buildAppGraph, serializeAppGraph, type AppGraph } from '@platformos/platformos-graph';

import { CACHE_FORMAT_VERSION, decodeCacheFile, encodeCacheFile } from './graph-cache-store';

/**
 * The persistence format (TASK-9.15 Phase 2): encode round-trips a built graph +
 * fingerprint, and decode is DEFENSIVE — a wrong-version, wrong-root, or corrupt
 * document decodes to `null` so the caller falls back to a full build (a bad
 * cache never yields a wrong answer, AC#5).
 */
describe('Unit: graph-cache-store (persisted graph encode/decode)', () => {
  let root: string;
  let rootUri: string;
  let graph: AppGraph;
  const fingerprint = new Map([
    ['file:///p/app/views/pages/index.liquid', '111:22'],
    ['file:///p/app/views/partials/card.liquid', '333:44'],
  ]);

  const abs = (rel: string) => nodePath.join(root, ...rel.split('/'));
  const write = async (rel: string, body: string) => {
    await mkdir(nodePath.dirname(abs(rel)), { recursive: true });
    await writeFile(abs(rel), body, 'utf8');
  };
  const canonicalNodes = (g: AppGraph) =>
    [...serializeAppGraph(g).nodes].sort((a, b) => a.uri.localeCompare(b.uri));

  beforeEach(async () => {
    root = await mkdtemp(nodePath.join(tmpdir(), 'pos-graph-store-'));
    rootUri = path.normalize(URI.file(root).toString());
    await write('app/views/pages/index.liquid', "{% render 'card' %}");
    await write('app/views/partials/card.liquid', '<div>{{ title }}</div>');
    const entryPoints = await recursiveReadDirectory(
      NodeFileSystem,
      rootUri,
      ([u]) => isLayout(u) || isPage(u) || isPartial(u),
    );
    graph = await buildAppGraph(rootUri, { fs: NodeFileSystem }, entryPoints);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips a graph + fingerprint through encode → decode', () => {
    const decoded = decodeCacheFile(encodeCacheFile(rootUri, graph, fingerprint), rootUri);
    if (!decoded) throw new Error('expected a decoded cache');

    expect(canonicalNodes(decoded.graph)).toEqual(canonicalNodes(graph));
    expect(decoded.graph.rootUri).toBe(rootUri);
    expect(decoded.fingerprint).toEqual(fingerprint);
    // Entry points are preserved so orphan/GC semantics match a from-scratch build.
    expect(decoded.graph.entryPoints.map((m) => m.uri).sort()).toEqual(
      graph.entryPoints.map((m) => m.uri).sort(),
    );
  });

  it('returns null for a wrong format version (never migrated)', () => {
    const encoded = encodeCacheFile(rootUri, graph, fingerprint);
    const bumped = JSON.stringify({
      ...JSON.parse(encoded),
      version: CACHE_FORMAT_VERSION + 1,
    });
    expect(decodeCacheFile(bumped, rootUri)).toBeNull();
  });

  it('returns null when the persisted root does not match the expected root', () => {
    const encoded = encodeCacheFile(rootUri, graph, fingerprint);
    expect(decodeCacheFile(encoded, 'file:///a/different/project')).toBeNull();
  });

  it('returns null for unparseable or structurally invalid content', () => {
    expect(decodeCacheFile('this is not json', rootUri)).toBeNull();
    expect(decodeCacheFile('{}', rootUri)).toBeNull();
    expect(
      decodeCacheFile(JSON.stringify({ version: CACHE_FORMAT_VERSION, rootUri }), rootUri),
    ).toBeNull();
  });
});
