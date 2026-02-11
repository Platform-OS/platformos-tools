import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { DocumentsLocator } from '@platformos/platformos-common';
import { path as pathUtils, SourceCodeType, visit } from '@platformos/platformos-check-common';
import { toLiquidHtmlAST, isLiquidHtmlNode } from '@platformos/liquid-html-parser';

import { getTheme, loadConfig } from '../index';
import { NodeFileSystem } from '../NodeFileSystem';
import { collectPartialUsages } from './argument-collector';
import { generateParamLine } from './doc-generator';
import { updateDocInSource, getExistingParams } from './doc-updater';
import { BackfillOptions, BackfillResult, PartialUsage } from './types';

/**
 * Extract the set of variable names used in a Liquid source file.
 * Only looks at top-level variable lookups (the root name, not nested properties).
 */
async function getUsedVariables(source: string): Promise<Set<string>> {
  const usedVars = new Set<string>();

  try {
    const ast = toLiquidHtmlAST(source);
    if (!isLiquidHtmlNode(ast)) {
      return usedVars;
    }

    await visit<SourceCodeType.LiquidHtml, void>(ast, {
      async VariableLookup(node) {
        if (node.name) {
          usedVars.add(node.name);
        }
      },
    });
  } catch {
    // Parse error - return empty set
  }

  return usedVars;
}

export { BackfillOptions, BackfillResult } from './types';

/**
 * Run the doc tag backfill process.
 *
 * This scans the project for function, render, and include tag usages,
 * collects the arguments passed to each partial, and updates/creates
 * doc tags in the corresponding partial files.
 */
export async function backfillDocs(
  options: BackfillOptions,
  log: (message: string) => void = console.log,
): Promise<BackfillResult> {
  const { rootPath, dryRun = false, markRequired = false, verbose = false } = options;

  const result: BackfillResult = {
    modified: [],
    skipped: [],
    errors: [],
  };

  log('Scanning for partial usages (function, render, include)...');

  // Load theme configuration
  const config = await loadConfig(undefined, rootPath);
  const theme = await getTheme(config);

  // Collect all partial usages from the theme
  const usageMap = await collectPartialUsages(theme, verbose, log);

  const totalCalls = Array.from(usageMap.values()).reduce(
    (sum, usage) =>
      sum + Array.from(usage.arguments.values()).reduce((s, a) => s + a.usageCount, 0),
    0,
  );
  log(`Found ${totalCalls} partial calls referencing ${usageMap.size} partials\n`);

  if (usageMap.size === 0) {
    log('No partial usages found.');
    return result;
  }

  log('Processing:');

  // Create a DocumentsLocator for resolving partial paths
  const documentsLocator = new DocumentsLocator(NodeFileSystem);
  const rootUri = URI.file(rootPath);

  // Process each partial
  for (const usage of usageMap.values()) {
    const { partialPath, tagType, arguments: args } = usage;

    try {
      // Resolve the partial file path
      const resolvedUri = await documentsLocator.locate(rootUri, tagType, partialPath);

      if (!resolvedUri) {
        log(`  [!] ${partialPath} - File not found`);
        result.errors.push({
          file: partialPath,
          error: 'File not found',
        });
        continue;
      }

      // Convert URI to filesystem path
      const filePath = pathUtils.fsPath(resolvedUri);

      // Read the file content
      let source: string;
      try {
        source = await fs.readFile(filePath, 'utf8');
      } catch (err) {
        log(`  [!] ${partialPath} - Failed to read file`);
        result.errors.push({
          file: partialPath,
          error: `Failed to read file: ${err}`,
        });
        continue;
      }

      // Get existing params to filter out duplicates
      const existingParams = await getExistingParams(source);
      const existingParamNames = new Set(existingParams.map((p) => p.name));

      // Get variables actually used in the partial
      const usedVariables = await getUsedVariables(source);

      // Generate param lines for new arguments only (if they're actually used)
      const newParamLines: string[] = [];
      const addedParams: string[] = [];

      for (const [argName, argInfo] of args) {
        if (existingParamNames.has(argName)) {
          continue; // Skip params that already exist
        }
        if (!usedVariables.has(argName)) {
          if (verbose) {
            log(`    [skip] ${argName} - not used in partial`);
          }
          continue; // Skip params that aren't used in the partial
        }
        newParamLines.push(generateParamLine(argName, argInfo.inferredType, !markRequired));
        addedParams.push(argName);
      }

      if (newParamLines.length === 0) {
        if (verbose) {
          log(`  [=] ${partialPath} - No changes needed`);
        }
        result.skipped.push(partialPath);
        continue;
      }

      // Update the source with new params
      const updatedSource = await updateDocInSource(source, newParamLines);

      if (!updatedSource) {
        if (verbose) {
          log(`  [=] ${partialPath} - No changes needed`);
        }
        result.skipped.push(partialPath);
        continue;
      }

      // Write the updated content (unless dry run)
      if (!dryRun) {
        await fs.writeFile(filePath, updatedSource, 'utf8');
      }

      const relativePath = path.relative(rootPath, filePath);
      log(`  [+] ${relativePath} - Added: ${addedParams.join(', ')}`);
      result.modified.push(partialPath);
    } catch (err) {
      log(`  [!] ${partialPath} - Error: ${err}`);
      result.errors.push({
        file: partialPath,
        error: String(err),
      });
    }
  }

  // Print summary
  log('');
  log(
    `Modified: ${result.modified.length} files | Skipped: ${result.skipped.length} | Errors: ${result.errors.length}`,
  );

  if (dryRun && result.modified.length > 0) {
    log('\n(Dry run - no files were actually modified)');
  }

  return result;
}

/**
 * CLI entry point for the backfill-docs command.
 */
export async function runBackfillDocsCLI(args: string[]): Promise<void> {
  const options: BackfillOptions = {
    rootPath: process.cwd(),
    dryRun: false,
    markRequired: false,
    verbose: false,
  };

  // Parse command line arguments
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run' || arg === '-n') {
      options.dryRun = true;
    } else if (arg === '--required' || arg === '-r') {
      options.markRequired = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  // First positional argument is the path
  if (positionalArgs.length > 0) {
    options.rootPath = path.resolve(positionalArgs[0]);
  }

  try {
    await backfillDocs(options);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Usage: theme-check backfill-docs [path] [options]

Scans a platformOS project for partial usages (function, render, include tags)
and backfills or updates {% doc %} tags in the corresponding partial files.

Arguments:
  path              Path to the project root (default: current directory)

Options:
  --dry-run, -n     Preview changes without writing files
  --required, -r    Mark new params as required (default: optional)
  --verbose, -v     Show detailed progress
  --help, -h        Show this help message

Examples:
  theme-check backfill-docs
  theme-check backfill-docs ./my-project --dry-run
  theme-check backfill-docs --verbose --required
`);
}
