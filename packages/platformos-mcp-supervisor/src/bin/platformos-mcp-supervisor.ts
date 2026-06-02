#!/usr/bin/env node
/**
 * CLI entrypoint for the platformOS MCP supervisor.
 *
 * Resolves the project directory from `--project <dir>` / `--project=<dir>`
 * or `POS_SUPERVISOR_PROJECT_DIR` (CLI argument wins). Boots `startServer`
 * and lets Node keep the process alive — `mcpServer.connect()` registers
 * the stdio transport but does not block, so the SIGINT / SIGTERM handlers
 * installed inside `startServer` own the lifetime.
 *
 * NB: source path lives at `src/bin/` because tsconfig's `rootDir` is
 * `src/`. The build emits `dist/bin/platformos-mcp-supervisor.js`, which is
 * what `package.json#bin` references. The shebang above is preserved by
 * tsc so the dist file is directly executable.
 */

import { createLogger } from '../core/logger';
import { startServer } from '../server';

function parseArgs(argv: ReadonlyArray<string>): { projectDir?: string; help: boolean } {
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

function printHelp(): void {
  process.stderr.write(
    [
      'Usage: platformos-mcp-supervisor [--project <dir>]',
      '',
      'Options:',
      '  --project <dir>   Path to the platformOS project root.',
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
  const { projectDir: argDir, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    process.exit(0);
  }

  const projectDir = argDir ?? process.env.POS_SUPERVISOR_PROJECT_DIR;
  if (!projectDir) {
    log('error: no project directory provided. Pass --project <dir> or set POS_SUPERVISOR_PROJECT_DIR.');
    printHelp();
    process.exit(1);
  }

  try {
    await startServer({ projectDir, log });
  } catch (e) {
    log(`server failed to start: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
