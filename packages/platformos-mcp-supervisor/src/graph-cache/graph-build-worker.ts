/**
 * Worker-thread entry point for a full project-graph build.
 *
 * WHY A THREAD. A cold build is ~36 s on a real project (pos-module-mcp), and a
 * CPU profile attributes **83.5% of it to ohm-js** — the PEG parser behind
 * `toLiquidHtmlAST`, run over ~808 liquid files. platformos-graph's own logic is
 * 0.2%. Being CPU-bound on Node's single thread, that build and a concurrent lint
 * do not interleave, they ADD: a first `validate_code` measured 51–65 s against
 * warm calls of ~1 s. Moving the parse off the main thread is the only option that
 * restores the lint's own latency instead of merely resharing the same CPU
 * (cooperative yielding would keep the total and slow the lint ~2x).
 *
 * The graph crosses the boundary through the SAME serialization the persisted
 * cache already relies on (`serializeAppGraph` / `deserializeAppGraph`), so no new
 * wire format is introduced. `entryPoints` travel as URIs alongside it, exactly as
 * `encodeCacheFile` stores them, because a serialized graph does not carry them.
 *
 * The worker deliberately uses the real `NodeFileSystem`: an injected
 * `AbstractFileSystem` could not be transferred, and tests exercise the
 * in-process build through `GraphCacheOptions.buildGraph` instead.
 *
 * Failures are POSTED, not thrown: an `error` event would surface as an opaque
 * worker error, whereas the message carries the original message and stack so the
 * supervisor's log names the real cause.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { NodeFileSystem } from '@platformos/platformos-check-node';
import { buildAppGraph, serializeAppGraph } from '@platformos/platformos-graph';

import type { GraphBuildRequest, GraphBuildResponse } from './build-in-worker.js';

async function main(): Promise<void> {
  const { rootUri, entryPoints } = workerData as GraphBuildRequest;
  const graph = await buildAppGraph(rootUri, { fs: NodeFileSystem }, entryPoints);

  const response: GraphBuildResponse = {
    ok: true,
    graph: serializeAppGraph(graph),
    entryPoints: graph.entryPoints.map((module) => module.uri),
  };
  parentPort?.postMessage(response);
}

main().catch((error: unknown) => {
  const response: GraphBuildResponse = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  parentPort?.postMessage(response);
});
