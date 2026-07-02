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

import { defaultGraphCachePath, GraphCache } from '../graph-cache/graph-cache';
import { createLogger, type Logger } from '../logger';
import { registerValidateCode, type SupervisorContext } from './validate-code';

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
  /** Tear down the transport. Idempotent. */
  shutdown: (reason?: string) => Promise<void>;
}

const SERVER_NAME = 'platformos-mcp-supervisor';
const DEFAULT_VERSION = '0.0.1';

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const log = opts.log ?? createLogger(SERVER_NAME);
  // One never-stale project-graph cache per server (keyed by this project root),
  // warmed from a persisted graph on the first blast-radius request (else built
  // lazily in the background), then kept fresh incrementally.
  const rootUri = path.normalize(path.URI.file(opts.projectDir));
  const graphCache = new GraphCache({
    rootUri,
    cachePath: defaultGraphCachePath(rootUri),
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
    await server.close();
  };

  installSignalHandlers(shutdown);

  return { server, context, shutdown };
}

function installSignalHandlers(shutdown: (reason?: string) => Promise<void>): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => process.exit(0));
    });
  }
}
