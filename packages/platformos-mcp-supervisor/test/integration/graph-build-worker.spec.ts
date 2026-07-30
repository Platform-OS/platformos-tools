/**
 * TASK-12.13: the project graph is built on a worker thread, because the build is
 * CPU-bound (a profile puts 83.5% of a ~36 s build in ohm-js, parsing ~808 liquid
 * files) and therefore does NOT interleave with a lint on Node's single thread —
 * the two add up, which is what made a first `validate_code` 51–65 s against ~1 s
 * warm.
 *
 * Exercised against the BUILT `dist`, like the stdio smoke test: a worker entry
 * point only exists as a compiled `.js` sibling, so vitest's on-the-fly transform
 * of `src` cannot load it. The package is built in `beforeAll` so the suite stays
 * self-contained under `yarn test`.
 *
 * The load-bearing assertion is EQUIVALENCE: a graph built off-thread must answer
 * `dependentsOf` exactly as the in-process build does. Everything else here guards
 * the lifecycle — failures must surface with their real cause, and a build in
 * flight must be reapable so it cannot hold the process open.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { path as pathUtils } from '@platformos/platformos-check-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { buildAppGraph, dependentsOf, type AppGraph } from '@platformos/platformos-graph';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const TSC = resolve(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

type WorkerBuilder = typeof import('../../src/graph-cache/build-in-worker.js');

let worker: WorkerBuilder;
let projectDir: string;
let rootUri: string;

beforeAll(async () => {
  try {
    execFileSync(process.execPath, [TSC, '-b', resolve(PACKAGE_ROOT, 'tsconfig.build.json')], {
      cwd: PACKAGE_ROOT,
      stdio: 'pipe',
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `Failed to build the package for the worker test:\n${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`,
    );
  }
  worker = (await import(
    resolve(PACKAGE_ROOT, 'dist', 'graph-cache', 'build-in-worker.js')
  )) as unknown as WorkerBuilder;

  projectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-worker-'));
  mkdirSync(join(projectDir, '.git'));
  const write = (rel: string, body: string) => {
    const abs = join(projectDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  };
  // `card` is rendered by two pages; `lonely` by nobody. Both facts must survive
  // the trip across the thread boundary.
  write('app/views/partials/card.liquid', '<div class="card">{{ title }}</div>');
  write('app/views/partials/lonely.liquid', '<div>nobody renders me</div>');
  write('app/views/pages/index.liquid', "{% render 'card' %}");
  write('app/views/pages/about.liquid', "{% render 'card' %}");
  write('app/views/layouts/theme.liquid', '<html>{{ content_for_layout }}</html>');
  rootUri = pathUtils.normalize(pathUtils.URI.file(projectDir));
}, 180_000);

afterAll(async () => {
  await worker?.terminateGraphBuildWorkers();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

const uri = (rel: string) => pathUtils.join(rootUri, ...rel.split('/'));

const dependentSources = (graph: AppGraph, rel: string): string[] =>
  dependentsOf(graph, uri(rel))
    .map((ref) => ref.source.uri)
    .sort();

describe('Integration: building the project graph on a worker thread', () => {
  it('produces a graph equivalent to the in-process build', async () => {
    const [offThread, inProcess] = await Promise.all([
      worker.buildAppGraphInWorker(rootUri),
      buildAppGraph(rootUri, { fs: NodeFileSystem }),
    ]);

    // The dependents relation is the whole point of the graph for the supervisor.
    expect(dependentSources(offThread, 'app/views/partials/card.liquid')).toEqual([
      uri('app/views/pages/about.liquid'),
      uri('app/views/pages/index.liquid'),
    ]);
    expect(dependentSources(offThread, 'app/views/partials/card.liquid')).toEqual(
      dependentSources(inProcess, 'app/views/partials/card.liquid'),
    );
    expect(dependentSources(offThread, 'app/views/partials/lonely.liquid')).toEqual([]);

    // Entry points survive the boundary: a serialized graph does not carry them,
    // so they are transferred alongside it.
    expect(offThread.entryPoints.map((module) => module.uri).sort()).toEqual(
      inProcess.entryPoints.map((module) => module.uri).sort(),
    );
    expect(Object.keys(offThread.modules).sort()).toEqual(Object.keys(inProcess.modules).sort());
  }, 120_000);

  it('reaps the worker once a build resolves', async () => {
    await worker.buildAppGraphInWorker(rootUri);

    expect(worker.activeGraphBuildWorkerCount()).toEqual(0);
  }, 120_000);

  it('resolves to an empty graph for a root with nothing in it, rather than failing', async () => {
    // Worth pinning: a root the build cannot make sense of is NOT an error — it
    // yields an empty graph. Blast radius then reports zero dependents, which is
    // exactly how `impact` degrades, so this must not be mistaken for a failure.
    const empty = await worker.buildAppGraphInWorker('not-a-uri');

    expect(empty.entryPoints).toEqual([]);
    expect(worker.activeGraphBuildWorkerCount()).toEqual(0);
  }, 120_000);

  it('rejects with the real cause when the build throws inside the worker', async () => {
    // A root that is a FILE, not a directory: the directory walk fails inside the
    // worker, and the message must reach the caller rather than an opaque worker
    // error. Proves the posted-failure path, not just the happy path.
    const fileAsRoot = pathUtils.normalize(
      pathUtils.URI.file(join(projectDir, 'app', 'views', 'pages', 'index.liquid')),
    );

    await expect(worker.buildAppGraphInWorker(fileAsRoot)).rejects.toThrow(
      /ENOTDIR|not a directory/i,
    );
    expect(worker.activeGraphBuildWorkerCount()).toEqual(0);
  }, 120_000);

  it('terminating a build in flight settles it and leaves no worker behind', async () => {
    const inFlight = worker.buildAppGraphInWorker(rootUri);
    expect(worker.activeGraphBuildWorkerCount()).toEqual(1);

    await worker.terminateGraphBuildWorkers();

    // It must settle rather than hang — a caller awaiting a build during shutdown
    // would otherwise never be released. Either outcome is acceptable: the worker
    // may have answered just before termination.
    await expect(Promise.allSettled([inFlight])).resolves.toHaveLength(1);
    expect(worker.activeGraphBuildWorkerCount()).toEqual(0);
  }, 120_000);
});
