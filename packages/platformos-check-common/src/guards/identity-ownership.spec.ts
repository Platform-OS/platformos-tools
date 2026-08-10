import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { relativePosixPath } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';

/**
 * platformos-common is the SINGLE owner of file identity — which directories hold
 * which type, which extensions are sources, what a path is called, whether we can
 * parse it. Consumers import those facts from `@platformos/platformos-common`
 * DIRECTLY, so an import line says which layer owns the fact and a deprecation
 * there surfaces at the importer.
 *
 * This scanner keeps the check packages' barrels from re-exporting that API: overlapping
 * re-exports let one file import the same subject from two packages.
 *
 * The one allowed re-export is check-node's `APP_SOURCE_SUBTREES`: the MCP supervisor
 * EXPLAINS the directory rule to an agent in prose, which is a different job from
 * applying it, and check-node is its only dependency.
 */
const packagesRoot = join(__dirname, '..', '..', '..');
const scannedPackages = ['platformos-check-common', 'platformos-check-node'];

describe('file identity has one owner', () => {
  const IDENTITY_SYMBOLS = new Set([
    'getFileType',
    'parseAppPath',
    'pathToName',
    'nameToPaths',
    'nameToCreationPath',
    'getAppPaths',
    'getModulePaths',
    'getAppDirPath',
    'getModuleDirPaths',
    'getTranslationBase',
    'getReferenceExtensions',
    'getFixedFilePath',
    'isFixedPathFileType',
    'parseModulePrefix',
    'isPartial',
    'isPage',
    'isSupportedSourceFile',
    'sourceCodeTypeOf',
    'formatRank',
    'PlatformOSFileType',
    'FILE_TYPE_DIRS',
    'FILE_TYPE_FILES',
    'MODULE_ROOTS',
    'APP_SOURCE_SUBTREES',
    'SOURCE_FILE_EXTENSIONS',
    'SOURCE_FILE_GLOB',
    'APP_WATCH_GLOBS',
  ]);

  const ALLOWED = new Set(['platformos-check-node/src/index.ts: APP_SOURCE_SUBTREES']);

  it('is never re-exported by the check packages', async () => {
    expect(await reExportsOf(IDENTITY_SYMBOLS, ALLOWED)).toEqual([]);
  });

  /**
   * THE CONTROL, for this scan and for the GraphQL one below — they are the same function
   * over the same walk.
   *
   * Every assertion here says a scan found nothing, and a scan that found nothing because it
   * scanned nothing says exactly the same thing: a renamed package, a moved `src`, or a
   * matcher that quietly stopped matching. That last one is not hypothetical — the pattern
   * only accepts SINGLE-quoted specifiers, so a formatting change alone would silence the
   * rule for good, green all the way.
   *
   * Run without the allowlist, the scan must still find the one re-export this repo really
   * has. That makes the emptiness above a fact about the code rather than about the scanner.
   */
  it('still finds the re-export the allowlist exempts, so an empty result means something', async () => {
    expect(await reExportsOf(IDENTITY_SYMBOLS, new Set())).toEqual([...ALLOWED]);
  });
});

/**
 * The same rule for the other fact platformos-common owns: how a platformOS GraphQL
 * document is READ — parsed, and asked for its tables and its variables. A check reads
 * the document its `AppFile` already parsed; nothing here re-exports the reader, or a
 * caller could import it from two packages and one of them would stop being the parse
 * the app performed.
 *
 * The `GraphQLDocumentNode` TYPE is deliberately absent from this list: check-common
 * re-exports it, exactly as it re-exports `SourceCodeType`, because its `AST` map is
 * keyed on it and two structurally equal types would be two types.
 */
describe('GraphQL reading has one owner', () => {
  const GRAPHQL_SYMBOLS = new Set([
    'parseGraphql',
    'isGraphqlDocument',
    'extractGraphqlTables',
    'extractGraphqlVariables',
  ]);

  it('is never re-exported by the check packages', async () => {
    expect(await reExportsOf(GRAPHQL_SYMBOLS, new Set())).toEqual([]);
  });
});

/** Every `export … from '@platformos/platformos-common'` of a symbol in `symbols`. */
async function reExportsOf(symbols: Set<string>, allowed: Set<string>): Promise<string[]> {
  const offenders: string[] = [];

  for (const packageName of scannedPackages) {
    for (const file of await sourceFiles(join(packagesRoot, packageName, 'src'))) {
      if (file.endsWith('.spec.ts')) continue;
      const source = await readFile(file, 'utf8');
      // Forward-slashed, so `allowed` is written once rather than once per OS.
      const relative = relativePosixPath(file, packagesRoot);

      for (const [, names] of source.matchAll(
        /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@platformos\/platformos-common'/gs,
      )) {
        for (const raw of names.split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0];
          if (!symbols.has(name)) continue;
          const offender = `${relative}: ${name}`;
          if (!allowed.has(offender)) offenders.push(offender);
        }
      }

      // A star re-export forwards the whole API in one line.
      if (/export\s+\*\s+from\s*'@platformos\/platformos-common'/.test(source)) {
        offenders.push(`${relative}: export *`);
      }
    }
  }

  return offenders;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return Promise.resolve(entry.name.endsWith('.ts') ? [full] : []);
    }),
  );
  return nested.flat();
}
