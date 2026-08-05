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

  const packagesRoot = join(__dirname, '..', '..');
  const scanned = ['platformos-check-common', 'platformos-check-node'];

  it('is never re-exported by the check packages', async () => {
    const offenders: string[] = [];

    for (const packageName of scanned) {
      for (const file of await sourceFiles(join(packagesRoot, packageName, 'src'))) {
        if (file.endsWith('.spec.ts')) continue;
        const source = await readFile(file, 'utf8');
        // Forward-slashed, so `ALLOWED` is written once rather than once per OS.
        const relative = relativePosixPath(file, packagesRoot);

        for (const [, names] of source.matchAll(
          /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@platformos\/platformos-common'/gs,
        )) {
          for (const raw of names.split(',')) {
            const name = raw.trim().split(/\s+as\s+/)[0];
            if (!IDENTITY_SYMBOLS.has(name)) continue;
            const offender = `${relative}: ${name}`;
            if (!ALLOWED.has(offender)) offenders.push(offender);
          }
        }

        // A star re-export forwards the whole identity API in one line.
        if (/export\s+\*\s+from\s*'@platformos\/platformos-common'/.test(source)) {
          offenders.push(`${relative}: export *`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

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
