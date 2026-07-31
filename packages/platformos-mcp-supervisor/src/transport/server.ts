/**
 * MCP stdio server lifecycle.
 *
 * `startServer` wires an `McpServer` to a `StdioServerTransport`, registers the
 * `validate_code` tool, and installs SIGINT/SIGTERM handlers. It is the
 * embedding surface; the bin (`bin/platformos-mcp-supervisor.ts`) is the
 * user-facing surface.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { path } from '@platformos/platformos-check-common';
import { AppCache } from '@platformos/platformos-check-node';

import {
  buildAppGraphInWorker,
  terminateGraphBuildWorkers,
} from '../graph-cache/build-in-worker.js';
import { defaultGraphCachePath, GraphCache } from '../graph-cache/graph-cache.js';
import { type SupervisorContext } from '../context.js';
import { createLogger, type Logger } from '../logger.js';
import { installProcessGuards } from './process-guards.js';
import { registerValidateCode } from './validate-code.js';

export interface ServerOptions {
  /** Absolute project root that buffers are validated against. */
  projectDir: string;
  /** Logger sink (stderr by default). */
  log?: Logger;
  /** Advertised server version. */
  version?: string;
}

export interface ServerHandle {
  server: McpServer;
  context: SupervisorContext;
  /**
   * The project-graph warm-up started at boot. Resolves when that attempt has
   * settled and NEVER rejects (see {@link GraphCache.warm}).
   *
   * Exposed so an embedder can await graph readiness deliberately — and so tests
   * can assert `startServer` does not await it. Ignoring it is the normal case:
   * blast radius degrades to `computing` until the graph lands.
   */
  graphWarmup: Promise<void>;
  /** Tear down the transport. Idempotent. */
  shutdown: (reason?: string) => Promise<void>;
}

const SERVER_NAME = 'platformos-mcp-supervisor';
const DEFAULT_VERSION = '0.0.1';

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const log = opts.log ?? createLogger(SERVER_NAME);
  // One never-stale project-graph cache per server (keyed by this project root),
  // warmed from a persisted graph (else built) at BOOT — see below — then kept
  // fresh incrementally.
  const rootUri = path.normalize(path.URI.file(opts.projectDir));
  const graphCache = new GraphCache({
    rootUri,
    cachePath: defaultGraphCachePath(rootUri),
    // Build on a worker thread. A cold build is ~36 s and a CPU profile puts 83.5%
    // of it in ohm-js (parsing ~808 liquid files), so on the main thread it does
    // not interleave with a lint — the two ADD, which is why a first
    // `validate_code` measured 51–65 s against ~1 s warm. Off-thread, the lint
    // keeps its own latency. Incremental reconciles stay in-process: they touch
    // only changed files and are milliseconds.
    buildGraph: (buildRoot, _fs, entryPoints) => buildAppGraphInWorker(buildRoot, entryPoints),
  });

  // Start the graph now rather than on the first request. Deliberately NOT
  // awaited: awaiting would hold `initialize` — and so the client handshake —
  // behind a build that takes tens of seconds on a large project. Firing it here
  // instead overlaps the cold cost with the client's own startup rather than with
  // its first `validate_code`, which previously turned a ~1 s call into 46–58 s
  // because the build and the lint contend for the one event loop.
  //
  // `warm()` never rejects; the `catch` is defence in depth so that an
  // instrumented or subclassed cache cannot turn this fire-and-forget into an
  // unhandled rejection that takes the process down.
  const warmStartedAt = Date.now();
  const graphWarmup = graphCache
    .warm()
    .then(() => log(`project graph warm-up settled in ${Date.now() - warmStartedAt} ms`))
    .catch((error: unknown) => {
      log(`project graph warm-up failed: ${error instanceof Error ? error.message : error}`);
    });
  // One never-stale parsed-project cache per server, so repeated lint calls reuse
  // the parsed project instead of re-parsing it (the dominant per-call cost).
  const appCache = new AppCache();
  const context: SupervisorContext = { projectDir: opts.projectDir, graphCache, appCache, log };

  const server = new McpServer({ name: SERVER_NAME, version: opts.version ?? DEFAULT_VERSION });
  registerValidateCode(server, context);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`listening on stdio (project: ${opts.projectDir})`);

  let closed = false;
  const shutdown = async (reason?: string) => {
    if (closed) return;
    closed = true;
    if (reason) log(`shutting down (${reason})`);
    // Drop the process listeners as part of teardown, so a start/stop/start cycle
    // in one process does not accumulate them.
    uninstallGuards();
    // Reap a build in flight first: a worker mid-parse holds the process open, and
    // its rejection is absorbed by GraphCache like any other build failure.
    await terminateGraphBuildWorkers();
    await server.close();
  };

  // Signals plus the last-resort error guards: without them a single unhandled
  // rejection on a background path is fatal under Node's default, and the agent
  // loses the tool mid-session with nothing in the JSON-RPC stream to explain it.
  const uninstallGuards = installProcessGuards({ log, shutdown });

  return { server, context, graphWarmup, shutdown };
}
