/**
 * Run a full project-graph build on a worker thread.
 *
 * This is a drop-in implementation of `GraphCacheOptions.buildGraph`, so
 * `GraphCache` itself is unchanged and still fully testable in-process — the
 * supervisor opts into the thread at wiring time, tests keep the in-process build.
 *
 * See `graph-build-worker.ts` for why a thread rather than cooperative yielding.
 *
 * ONE-SHOT: a worker is spawned per build and terminated as soon as it answers.
 * Builds are rare (cold start, or a rebuild after a failed incremental apply), so
 * ~30 ms of spawn cost is irrelevant, and a short-lived thread cannot leak the
 * second heap that parsing a whole project allocates — which matters, since the
 * main thread already holds ~930 MB with the parsed-project cache warm.
 */
import { Worker } from 'node:worker_threads';

import type { UriString } from '@platformos/platformos-check-common';
import {
  deserializeAppGraph,
  type AppGraph,
  type SerializableGraph,
} from '@platformos/platformos-graph';

/** What the parent sends to a build worker (must be structured-cloneable). */
export interface GraphBuildRequest {
  rootUri: UriString;
  /** Explicit scope, or `undefined` to let the build discover entry points. */
  entryPoints?: UriString[];
}

/**
 * What a build worker sends back. A serialized graph does not carry its entry
 * points, so they travel alongside — the same pairing `encodeCacheFile` persists.
 */
export type GraphBuildResponse =
  | { ok: true; graph: SerializableGraph; entryPoints: UriString[] }
  | { ok: false; message: string; stack?: string };

/**
 * The workers currently building. Tracked so a server shutdown can terminate a
 * build in flight instead of leaving a thread parsing a project nobody is waiting
 * for (which would keep the process alive).
 */
const active = new Set<Worker>();

/** Resolved relative to the compiled sibling, so it works from `dist` regardless of cwd. */
const WORKER_URL = new URL('./graph-build-worker.js', import.meta.url);

export function buildAppGraphInWorker(
  rootUri: UriString,
  entryPoints?: UriString[],
): Promise<AppGraph> {
  return new Promise<AppGraph>((resolve, reject) => {
    const request: GraphBuildRequest = { rootUri, entryPoints };
    const worker = new Worker(WORKER_URL, { workerData: request });
    active.add(worker);

    // Every path below routes through here, so the worker is always reaped and the
    // promise settles exactly once — including the `exit` that follows a normal
    // answer, and a `terminate()` racing an in-flight message.
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      active.delete(worker);
      void worker.terminate();
      action();
    };

    worker.once('message', (response: GraphBuildResponse) => {
      if (response.ok) {
        settle(() => resolve(deserializeAppGraph(response.graph, response.entryPoints)));
        return;
      }
      const error = new Error(response.message);
      if (response.stack) error.stack = response.stack;
      settle(() => reject(error));
    });

    // An `error` event means the worker could not run at all (module resolution,
    // an uncaught throw outside the handler); `main()` posts its own failures.
    worker.once('error', (error: Error) => settle(() => reject(error)));

    // Exiting before answering (an OOM kill, or `terminateGraphBuildWorkers`)
    // must not leave the caller hanging forever.
    worker.once('exit', (code: number) =>
      settle(() =>
        reject(new Error(`graph build worker exited with code ${code} before returning a graph`)),
      ),
    );
  });
}

/**
 * Terminate any build in flight. Called on server shutdown; safe to call when
 * nothing is building.
 *
 * A rejected in-flight build is absorbed by `GraphCache` exactly like any other
 * build failure (it records the error and a later request retries), so shutting
 * down mid-build cannot surface an unhandled rejection.
 */
export async function terminateGraphBuildWorkers(): Promise<void> {
  const workers = [...active];
  active.clear();
  await Promise.all(workers.map((worker) => worker.terminate()));
}

/** Number of build workers currently running. Exposed for tests and diagnostics. */
export function activeGraphBuildWorkerCount(): number {
  return active.size;
}
