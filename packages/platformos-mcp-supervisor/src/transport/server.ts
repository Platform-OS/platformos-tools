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

import { type SupervisorContext } from '../context.js';
import { createLogger, type Logger } from '../logger.js';
import { installProcessGuards } from './process-guards.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
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
  /** Tear down the transport. Idempotent. */
  shutdown: (reason?: string) => Promise<void>;
}

const SERVER_NAME = 'platformos-mcp-supervisor';
const DEFAULT_VERSION = '0.0.1';

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const log = opts.log ?? createLogger(SERVER_NAME);
  // NOTHING IS BUILT OR WARMED HERE, by design. check-node owns one lazy `App` per project
  // at process level and reconciles it per call, and impact is derived per request from
  // the project's text (`impact/project-scan.ts`) — so there is no graph to build at boot,
  // nothing to keep fresh, and no "still computing" answer.
  const context: SupervisorContext = { projectDir: opts.projectDir, log };

  // `instructions` reaches the model with the tool list; without them an agent has only the
  // tool description to go on and invents a reading of the result (see instructions.ts).
  const server = new McpServer(
    { name: SERVER_NAME, version: opts.version ?? DEFAULT_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
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
    await server.close();
  };

  // Signals plus the last-resort error guards: without them a single unhandled
  // rejection on a background path is fatal under Node's default, and the agent
  // loses the tool mid-session with nothing in the JSON-RPC stream to explain it.
  const uninstallGuards = installProcessGuards({ log, shutdown });

  return { server, context, shutdown };
}
