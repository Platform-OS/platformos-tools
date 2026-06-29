import nodePath from 'node:path';
import { path } from '@platformos/platformos-check-common';
import { AbstractFileSystem, FileType } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { buildSerializedFileDependencies, buildSerializedGraph, nodeFileSystem } from './cli';
import { skeleton } from './graph/test-helpers';
import { LiquidModuleKind, ModuleType } from './types';

const skeletonPath = path.fsPath(skeleton);
const p = (rel: string) => path.join(skeleton, ...rel.split('/'));
const fsPathOf = (rel: string) => nodePath.join(skeletonPath, ...rel.split('/'));

describe('platformos-graph CLI: buildSerializedGraph', () => {
  it('serializes the full node and edge set for a project path', async () => {
    const graph = await buildSerializedGraph(skeletonPath);

    // Root is the project path re-expressed as a file URI.
    expect(graph.rootUri).toBe(URI.file(skeletonPath).toString(true));

    // Whole node set, sorted by URI so the assertion is order-independent.
    expect([...graph.nodes].sort((a, b) => a.uri.localeCompare(b.uri))).toEqual([
      {
        uri: p('app/views/layouts/application.liquid'),
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Layout,
        exists: true,
      },
      {
        uri: p('app/views/pages/index.liquid'),
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Page,
        exists: true,
      },
      {
        uri: p('app/views/partials/child.liquid'),
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Partial,
        exists: true,
      },
      {
        uri: p('app/views/partials/header.liquid'),
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Partial,
        exists: true,
      },
      {
        uri: p('app/views/partials/parent.liquid'),
        type: ModuleType.Liquid,
        kind: LiquidModuleKind.Partial,
        exists: true,
      },
      {
        uri: p('assets/app.css'),
        type: ModuleType.Asset,
        kind: 'unused',
        exists: true,
      },
      {
        uri: p('assets/app.js'),
        type: ModuleType.Asset,
        kind: 'unused',
        exists: true,
      },
    ]);

    // Whole edge set, reduced to (source, target, type, kind) and sorted, so an
    // extra, missing, or mis-kinded edge fails the assertion.
    const edges = graph.edges
      .map((edge) => ({
        source: edge.source.uri,
        target: edge.target.uri,
        type: edge.type,
        kind: edge.kind,
      }))
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

    expect(edges).toEqual([
      {
        source: p('app/views/layouts/application.liquid'),
        target: p('app/views/partials/header.liquid'),
        type: 'direct',
        kind: 'render',
      },
      {
        source: p('app/views/layouts/application.liquid'),
        target: p('assets/app.css'),
        type: 'direct',
        kind: 'asset',
      },
      {
        source: p('app/views/layouts/application.liquid'),
        target: p('assets/app.js'),
        type: 'direct',
        kind: 'asset',
      },
      {
        source: p('app/views/pages/index.liquid'),
        target: p('app/views/partials/parent.liquid'),
        type: 'direct',
        kind: 'render',
      },
      {
        source: p('app/views/partials/header.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
      {
        source: p('app/views/partials/parent.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
    ]);
  });
});

describe('platformos-graph CLI: nodeFileSystem', () => {
  it('reads a file by URI', async () => {
    const uri = path.join(skeleton, 'assets', 'app.js');
    expect(await nodeFileSystem.readFile(uri))
      .toBe(`// Skeleton app bundle (asset reference target).
`);
  });

  it('stats a directory and a file', async () => {
    expect(await nodeFileSystem.stat(path.join(skeleton, 'assets'))).toEqual({
      type: FileType.Directory,
      size: expect.any(Number),
    });
    expect(await nodeFileSystem.stat(path.join(skeleton, 'assets', 'app.css'))).toEqual({
      type: FileType.File,
      size: expect.any(Number),
    });
  });

  it('lists a directory as [childUri, FileType] tuples', async () => {
    const entries = await nodeFileSystem.readDirectory(path.join(skeleton, 'assets'));
    expect([...entries].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      [path.join(skeleton, 'assets', 'app.css'), FileType.File],
      [path.join(skeleton, 'assets', 'app.js'), FileType.File],
    ]);
  });
});

describe('platformos-graph CLI: buildSerializedFileDependencies', () => {
  const edge = (ref: {
    source: { uri: string };
    target: { uri: string };
    type: string;
    kind?: string;
  }) => ({
    source: ref.source.uri,
    target: ref.target.uri,
    type: ref.type,
    kind: ref.kind,
  });

  it('returns the outgoing and incoming edges of a single file', async () => {
    const result = await buildSerializedFileDependencies(
      skeletonPath,
      fsPathOf('app/views/partials/parent.liquid'),
    );

    expect(result.uri).toBe(p('app/views/partials/parent.liquid'));
    expect(result.dependencies.map(edge)).toEqual([
      {
        source: p('app/views/partials/parent.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
    ]);
    expect(result.references.map(edge)).toEqual([
      {
        source: p('app/views/pages/index.liquid'),
        target: p('app/views/partials/parent.liquid'),
        type: 'direct',
        kind: 'render',
      },
    ]);
  });

  it('returns no dependencies for a leaf partial and every incoming reference', async () => {
    const result = await buildSerializedFileDependencies(
      skeletonPath,
      fsPathOf('app/views/partials/child.liquid'),
    );

    expect(result.uri).toBe(p('app/views/partials/child.liquid'));
    expect(result.dependencies).toEqual([]);
    expect(result.references.map(edge).sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      {
        source: p('app/views/partials/header.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
      {
        source: p('app/views/partials/parent.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
    ]);
  });

  it('resolves a relative file argument against the project root, not the cwd', async () => {
    const result = await buildSerializedFileDependencies(
      skeletonPath,
      'app/views/partials/parent.liquid',
    );

    expect(result.uri).toBe(p('app/views/partials/parent.liquid'));
    expect(result.dependencies.map(edge)).toEqual([
      {
        source: p('app/views/partials/parent.liquid'),
        target: p('app/views/partials/child.liquid'),
        type: 'direct',
        kind: 'render',
      },
    ]);
  });

  it('throws for a file that is not part of the app graph', async () => {
    const missing = fsPathOf('app/views/partials/nonexistent.liquid');
    const missingUri = path.normalize(URI.file(missing));
    const rootUri = path.normalize(URI.file(skeletonPath));

    const error = await buildSerializedFileDependencies(skeletonPath, missing).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `File is not part of the app graph: ${missingUri}\n` +
        `It must exist and be reachable from a layout or page entry point. ` +
        `Check the path is correct and inside the project root (${rootUri}).`,
    );
  });
});

describe('platformos-graph CLI: project-root validation', () => {
  /**
   * A filesystem where nothing exists. Injected so `findRoot` walks up from the
   * given path entirely in memory — no real disk, no dependency on what sits
   * above the OS temp dir — and deterministically finds no project marker.
   */
  const emptyFs: AbstractFileSystem = {
    stat: () => Promise.reject(new Error('ENOENT')),
    readFile: () => Promise.reject(new Error('ENOENT')),
    readDirectory: () => Promise.resolve([]),
  };

  it('throws instead of emitting an empty graph for a non-platformOS directory', async () => {
    const dir = nodePath.resolve('no-such-project', 'sub');
    const startUri = path.normalize(URI.file(dir));

    const error = await buildSerializedGraph(dir, emptyFs).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `Not a platformOS project: ${startUri}\n` +
        `No app/, modules/, .pos, or .platformos-check.yml found at or above this path. ` +
        `Pass the path to a platformOS app directory.`,
    );
  });
});
