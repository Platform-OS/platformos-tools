#!/usr/bin/env node
/**
 * CLI entrypoint for the platformOS MCP supervisor.
 *
 * Resolves the project directory by precedence:
 *   1. `--project <dir>` / `--project=<dir>` (wins)
 *   2. `POS_SUPERVISOR_PROJECT_DIR` environment variable
 *   3. `process.cwd()` — the directory the MCP client launched the bin from
 *
 * Boots `startServer` and lets Node keep the process alive: `server.connect()`
 * registers the stdio transport but does not block, so the SIGINT/SIGTERM
 * handlers installed inside `startServer` own the lifetime.
 *
 * The source lives under `src/bin/` (tsconfig `rootDir` is `src`); the build
 * emits `dist/bin/platformos-mcp-supervisor.js`, which `package.json#bin`
 * references. tsc preserves the shebang so the dist file is executable.
 *
 * Pure arg/dir resolution lives in `./args` so it can be unit-tested without
 * importing this module (which boots the server on load).
 */
import { createLogger } from '../logger';
import { startServer } from '../transport/server';
import { HELP, parseArgs, resolveProjectDir } from './args';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(HELP);
    return;
  }

  const log = createLogger('platformos-mcp-supervisor');
  const projectDir = resolveProjectDir(args, process.env, process.cwd());
  await startServer({ projectDir, log });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
