/**
 * Pure CLI argument + project-directory resolution for the bin.
 *
 * Kept separate from the bin entrypoint (which runs `main()` on import) so it
 * can be unit-tested without booting a server.
 */
export interface ParsedArgs {
  projectDir?: string;
  help: boolean;
}

/**
 * Parse `--project <dir>` / `--project=<dir>` / `--help` / `-h` from a
 * `process.argv.slice(2)`-style array. Unknown flags are tolerated so a
 * forward-compatible client can pass extras without breaking the bin.
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
 * Resolve the project directory by precedence:
 *   1. `--project` argument, 2. `POS_SUPERVISOR_PROJECT_DIR`, 3. cwd.
 */
export function resolveProjectDir(args: ParsedArgs, env: NodeJS.ProcessEnv, cwd: string): string {
  return args.projectDir ?? env.POS_SUPERVISOR_PROJECT_DIR ?? cwd;
}

export const HELP = `platformos-mcp-supervisor — MCP stdio server exposing validate_code

Usage:
  platformos-mcp-supervisor [--project <dir>]

Options:
  --project <dir>   Project root to validate against
                    (env: POS_SUPERVISOR_PROJECT_DIR; default: current directory)
  -h, --help        Show this help
`;
