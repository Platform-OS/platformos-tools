import { appCheckRun } from './index';
import { allChecks } from '@platformos/platformos-check-common';
import { runBackfillDocsCLI } from './backfill-docs';
import path from 'node:path';

const validCheckNames = new Set(allChecks.map((c) => c.meta.code));

interface ParsedArgs {
  root: string;
  configPath?: string;
  checks?: string[];
}

function parseCheckArgs(args: string[]): ParsedArgs {
  const checks: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check' || args[i] === '-c') {
      i++;
      if (i < args.length) checks.push(args[i]);
    } else {
      positional.push(args[i]);
    }
  }

  return {
    root: path.resolve(positional[0] || '.'),
    configPath: positional[1] ? path.resolve(positional[1]) : undefined,
    checks: checks.length > 0 ? checks : undefined,
  };
}

async function runCheck(args: string[]): Promise<void> {
  const { root, configPath, checks } = parseCheckArgs(args);

  if (checks) {
    const unknown = checks.filter((name) => !validCheckNames.has(name));
    if (unknown.length > 0) {
      const available = Array.from(validCheckNames).sort().join(', ');
      console.error(`Unknown check${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
      console.error(`Available checks: ${available}`);
      process.exit(1);
    }
  }

  const { app, config, offenses } = await appCheckRun(
    root,
    configPath,
    console.error.bind(console),
  );

  const filtered = checks ? offenses.filter((o) => checks.includes(o.check)) : offenses;

  console.log(JSON.stringify(filtered, null, 2));
  if (!checks) {
    console.log(JSON.stringify(config, null, 2));
    console.log(
      JSON.stringify(
        app.map((x) => x.uri),
        null,
        2,
      ),
    );
  }
}

function printUsage(): void {
  console.log(`
Usage: platformos-check [command] [options] [path] [configPath]

Commands:
  <path>              Run platformos checks on the specified path (default: .)
  backfill-docs       Backfill doc tags in partial files based on usage

Options:
  --check, -c <name>  Only show offenses from the named check (repeatable)
  --help, -h          Show this help message

Examples:
  platformos-check .
  platformos-check . --check MissingPage
  platformos-check . -c MissingPage -c UnknownFilter

Run 'platformos-check <command> --help' for more information on a command.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  if (command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === 'backfill-docs') {
    await runBackfillDocsCLI(args.slice(1));
    return;
  }

  // Default: run platformos check
  await runCheck(args);
}

main();
