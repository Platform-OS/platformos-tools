import { themeCheckRun } from './index';
import { runBackfillDocsCLI } from './backfill-docs';
import path from 'node:path';

async function runThemeCheck(args: string[]): Promise<void> {
  const root = path.resolve(args[0] || '.');
  const configPath = args[1] ? path.resolve(args[1]) : undefined;
  const { theme, config, offenses } = await themeCheckRun(
    root,
    configPath,
    console.error.bind(console),
  );
  console.log(JSON.stringify(offenses, null, 2));
  console.log(JSON.stringify(config, null, 2));
  console.log(
    JSON.stringify(
      theme.map((x) => x.uri),
      null,
      2,
    ),
  );
}

function printUsage(): void {
  console.log(`
Usage: theme-check [command] [options]

Commands:
  <path>              Run theme checks on the specified path (default)
  backfill-docs       Backfill doc tags in partial files based on usage

Run 'theme-check <command> --help' for more information on a command.
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

  // Default: run theme check
  await runThemeCheck(args);
}

main();
