#!/usr/bin/env node
/**
 * CLI entrypoint for the platformOS MCP supervisor.
 *
 * Resolves the project directory by precedence:
 *
 *   1. `--project <dir>` / `--project=<dir>` CLI argument (wins).
 *   2. `POS_SUPERVISOR_PROJECT_DIR` environment variable.
 *   3. `process.cwd()` — the directory the MCP client (Claude Code,
 *      opencode, VS Code MCP host, etc.) spawned the bin from.
 *
 * The cwd default matches source pos-supervisor's behaviour and removes
 * boilerplate from typical MCP-client configurations: clients launch the
 * server from the project they want validated, so the implicit project
 * dir is correct by construction. Override only when the bin's cwd is
 * not the project root (e.g. system-service launch, multiplexed clients).
 *
 * Boots `startServer` and lets Node keep the process alive —
 * `mcpServer.connect()` registers the stdio transport but does not block,
 * so the SIGINT / SIGTERM handlers installed inside `startServer` own the
 * lifetime.
 *
 * NB: source path lives at `src/bin/` because tsconfig's `rootDir` is
 * `src/`. The build emits `dist/bin/platformos-mcp-supervisor.js`, which is
 * what `package.json#bin` references. The shebang above is preserved by
 * tsc so the dist file is directly executable.
 */

import { createLogger } from '../core/logger';
import { startServer } from '../server';

export interface ParsedArgs {
  projectDir?: string;
  help: boolean;
}

/**
 * Parse the `--project <dir>` / `--project=<dir>` / `--help` / `-h` flags
 * from a `process.argv.slice(2)` style array. Unknown flags are tolerated
 * (ignored) so a forward-compatible client can pass extras without
 * breaking the bin. Exported as a test seam.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let projectDir: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--project') {
      projectDir = argv[i + 1];
      i++;
    } else if (arg.startsWith('--project=')) {
      projectDir = arg.slice('--project='.length);
    }
  }
  return { projectDir, help };
}

/**
 * Resolve the project directory by the documented precedence chain:
 *
 *   1. `--project <dir>` / `--project=<dir>` CLI argument (wins).
 *   2. `POS_SUPERVISOR_PROJECT_DIR` environment variable.
 *   3. `process.cwd()` — the directory the MCP client spawned the bin from.
 *
 * Pure function: takes the parsed-args object, an env map, and a cwd
 * provider so unit tests can pin every branch without touching `process`.
 *
 * The cwd fallback is correct-by-construction for MCP clients (Claude
 * Code, opencode, VS Code MCP host) that spawn the server from the
 * project they want validated. The CLI flag / env var override is
 * reserved for system-service launches where the bin's cwd is unrelated
 * to the project.
 */
export function resolveProjectDir(
  parsed: ParsedArgs,
  env: Readonly<Record<string, string | undefined>>,
  cwd: () => string,
): string {
  if (parsed.projectDir && parsed.projectDir.length > 0) return parsed.projectDir;
  const envDir = env.POS_SUPERVISOR_PROJECT_DIR;
  if (envDir && envDir.length > 0) return envDir;
  return cwd();
}

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: platformos-mcp-supervisor [--project <dir>]',
      '',
      'Options:',
      '  --project <dir>   Path to the platformOS project root.',
      '                    Defaults to POS_SUPERVISOR_PROJECT_DIR, then process.cwd().',
      '  -h, --help        Show this help message.',
      '',
      'Environment:',
      '  POS_SUPERVISOR_PROJECT_DIR  Used when --project is omitted.',
      '',
      'The server speaks MCP over stdio. stderr is reserved for logs;',
      'stdout carries the JSON-RPC stream.',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const log = createLogger('platformos-mcp-supervisor');
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  const projectDir = resolveProjectDir(parsed, process.env, () => process.cwd());

  try {
    await startServer({ projectDir, log });
  } catch (e) {
    log(`server failed to start: ${(e as Error).message}`);
    process.exit(1);
  }
}

// Only auto-invoke when this file IS the Node entry point. Spec files
// that import `parseArgs` / `resolveProjectDir` for unit testing pick up
// the module without booting a real LSP + stdio transport. The package
// emits CommonJS, so `require.main === module` is the canonical guard.
if (require.main === module) {
  void main();
}
