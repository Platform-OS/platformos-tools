/**
 * Pure CLI argument + project-directory resolution for the bin.
 *
 * Kept separate from the bin entrypoint (which runs `main()` on import) so it
 * can be unit-tested without booting a server.
 */
export interface ParsedArgs {
  projectDir?: string;
  /** `false` only when `--no-impact` was passed. Cross-file impact is ON by default. */
  impact: boolean;
  help: boolean;
}

/**
 * Parse `--project <dir>` / `--project=<dir>` / `--no-impact` / `--help` / `-h` from a
 * `process.argv.slice(2)`-style array. Unknown flags are tolerated so a
 * forward-compatible client can pass extras without breaking the bin.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let projectDir: string | undefined;
  let impact = true;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--no-impact') {
      impact = false;
    } else if (arg === '--project') {
      projectDir = argv[i + 1];
      i++;
    } else if (arg.startsWith('--project=')) {
      projectDir = arg.slice('--project='.length);
    }
  }

  return { projectDir, impact, help };
}

/**
 * Whether cross-file impact runs, by precedence: `--no-impact` wins, then
 * `POS_SUPERVISOR_NO_IMPACT` (any non-empty value other than `0`/`false`), then ON.
 *
 * A SERVER setting rather than a tool parameter, deliberately. The per-call knob would put
 * the choice with the agent, and an agent that does not know it is editing a shared partial
 * is exactly the one that would not ask for the check — this server exists for what the
 * agent does not know. It also keeps the tool surface unchanged: `mode` was a real parameter
 * here once and was retired, and `stdio-smoke.spec.ts` still asserts a stale one is ignored.
 */
export function resolveImpactEnabled(args: ParsedArgs, env: NodeJS.ProcessEnv): boolean {
  if (!args.impact) return false;
  const disabled = env.POS_SUPERVISOR_NO_IMPACT;
  if (disabled === undefined || disabled === '' || disabled === '0' || disabled === 'false') {
    return true;
  }
  return false;
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
  platformos-mcp-supervisor [--project <dir>] [--no-impact]

Options:
  --project <dir>   Project root to validate against
                    (env: POS_SUPERVISOR_PROJECT_DIR; default: current directory)
  --no-impact       Do not compute cross-file impact. Each result still reports
                    every finding in the buffers you send; it simply stops
                    reporting what your change breaks in files you are NOT
                    editing. Costs ~240 ms per request on a 2,600-file project.
                    (env: POS_SUPERVISOR_NO_IMPACT=1)
  -h, --help        Show this help
`;
