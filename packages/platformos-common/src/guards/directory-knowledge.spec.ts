import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePosixPath } from '../os-path';
import {
  FILE_TYPE_DIRS,
  PlatformOSFileType,
  SOURCE_FILE_EXTENSIONS,
  SOURCE_FILE_GLOB,
} from '../path-utils';

const packagesDir = join(__dirname, '..', '..', '..');

/** Packages exempt from both rules below, with the reason. */
const EXEMPT = new Set([
  // Owns the source of truth.
  'platformos-common',
  // A browser demo whose fixture project is literal example content, not logic.
  'codemirror-language-client',
  // Liquid grammar and printer; they never classify project files.
  'liquid-html-parser',
  'prettier-plugin-liquid',
]);

/**
 * `FILE_TYPE_DIRS` in this package is the single source of truth for the platformOS directory
 * structure. This test keeps it that way.
 */
describe('platformOS directory knowledge lives only in platformos-common', () => {
  /**
   * The directory names this test polices: the multi-segment ones from `FILE_TYPE_DIRS`, plus
   * `assets` and the legacy app root.
   */
  const directoryNames = [
    ...new Set(
      Object.values(FILE_TYPE_DIRS)
        .flat()
        .filter((dir) => dir.includes('/')),
    ),
    ...FILE_TYPE_DIRS[PlatformOSFileType.Asset],
    'marketplace_builder',
  ];

  /**
   * Every regex metacharacter, `\\` included. A partial escape builds a pattern that
   * matches something other than the directory name it was built from.
   */
  const escapeForRegExp = (value: string) => value.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

  /**
   * The two ways a directory name gets spelled:
   */
  const spellings = (name: string) => {
    const escaped = escapeForRegExp(name);
    const segments = name.split('/').map((segment) => `['"\`]${escapeForRegExp(segment)}['"\`]`);
    return [
      // `(?<!\*)` exempts a `**/`-rooted glob (`ASSET_FILE_OPERATION_GLOB`'s `'**/assets/**'`).
      // Such a pattern is root-AGNOSTIC by construction — it matches the directory
      // under every legal root — so it cannot disagree with the placement rule the
      // way a hardcoded `app/assets` can.
      new RegExp(`((?<!\\*)\\/${escaped}[\\/'"\`])|(['"\`]${escaped}\\/)`),
      new RegExp(segments.join(',\\s*')),
    ];
  };

  /**
   * Known remaining offenders. Empty — and it must stay that way: adding a
   * directory name to another package fails this test, which is the point.
   */
  const KNOWN: string[] = [];

  it('spells no platformOS directory name outside this package', async () => {
    const offenders = new Set<string>();

    for (const dir of await workspacePackages()) {
      if (EXEMPT.has(relativePosixPath(dir, packagesDir))) continue;

      for (const file of await sourceFiles(join(dir, 'src'))) {
        // Forward-slashed, so the `/test/` skip and the reported names are one
        // spelling rather than one per OS.
        const relative = relativePosixPath(file, packagesDir);
        if (relative.endsWith('.spec.ts') || relative.includes('/test/')) continue;

        const code = codeOf(await readFile(file, 'utf8'));
        if (directoryNames.some((name) => spellings(name).some((re) => re.test(code)))) {
          offenders.add(relative);
        }
      }
    }

    expect([...offenders].sort()).toEqual([...KNOWN].sort());
  });

  it('is the only place that maps a translations directory name', () => {
    // Sanity check on the exported helper the translation checks now use, so they
    // have no reason to spell the directory themselves.
    expect(FILE_TYPE_DIRS[PlatformOSFileType.Translation]).toEqual(['translations']);
  });
});

/**
 * The second fact about a file this package owns: which EXTENSIONS are sources.
 */
describe('platformOS source-extension knowledge lives only in platformos-common', () => {
  const extensions = SOURCE_FILE_EXTENSIONS.map((extension) => extension.slice(1));

  /**
   * The two extension-SHAPED spellings:
   */
  const spellings = (extension: string) => [
    new RegExp(`\\.${extension}(?=['"\`$])`),
    new RegExp(`[{,]${extension}[,}]`),
  ];

  /** Known remaining offenders. Empty, and worth keeping that way. */
  const KNOWN: string[] = [];

  it('spells no list of source extensions outside this package', async () => {
    const offenders = new Set<string>();

    for (const dir of await workspacePackages()) {
      if (EXEMPT.has(relativePosixPath(dir, packagesDir))) continue;

      for (const file of await sourceFiles(join(dir, 'src'))) {
        const relative = relativePosixPath(file, packagesDir);
        if (relative.endsWith('.spec.ts') || relative.includes('/test/')) continue;

        const code = codeOf(await readFile(file, 'utf8'));
        const spelled = extensions.filter((extension) =>
          spellings(extension).some((re) => re.test(code)),
        );
        if (spelled.length >= 2) offenders.add(relative);
      }
    }

    expect([...offenders].sort()).toEqual([...KNOWN].sort());
  });

  it('derives the source glob from the extension list', () => {
    expect(SOURCE_FILE_GLOB).toEqual(`**/*.{${extensions.join(',')}}`);
  });

  /**
   * Specs are exempt from the rule above and NOT from this one, because the two spellings are
   * not equally suspicious in a test.
   */
  const GLOB_LITERAL_OWNERS = new Set([
    // Pins `SOURCE_FILE_GLOB`'s VALUE as the expected half of a whole-value assertion.
    // Restating it is the point there — it is what turns a change to the source
    // extensions into a visible diff instead of a tautology that cannot fail.
    'platformos-language-server-common/src/server/startServer.spec.ts',
  ]);

  it('spells no source-extension glob in a spec either', async () => {
    const offenders = new Set<string>();

    for (const dir of await workspacePackages()) {
      if (EXEMPT.has(relativePosixPath(dir, packagesDir))) continue;

      for (const file of await testFiles(dir)) {
        const relative = relativePosixPath(file, packagesDir);
        if (GLOB_LITERAL_OWNERS.has(relative)) continue;

        const code = codeOf(await readFile(file, 'utf8'));
        const spelled = extensions.filter((extension) =>
          new RegExp(`[{,]${extension}[,}]`).test(code),
        );
        if (spelled.length >= 2) offenders.add(relative);
      }
    }

    expect([...offenders].sort()).toEqual([]);
  });
});

/** `source` with comment lines removed — a comment may name a directory freely. */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

async function workspacePackages(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(packagesDir, entry.name);
        return (await exists(join(dir, 'src'))) ? [dir] : [];
      }),
  );
  return dirs.flat();
}

async function sourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return Promise.resolve(entry.name.endsWith('.ts') ? [full] : []);
    }),
  );
  return nested.flat();
}

/**
 * Every test file of a package: `*.spec.ts` anywhere under `src/`, plus everything under
 * a top-level `test/`.
 */
async function testFiles(packageDir: string): Promise<string[]> {
  const [inSrc, inTest] = await Promise.all([
    sourceFiles(join(packageDir, 'src')),
    sourceFiles(join(packageDir, 'test')),
  ]);
  return [...inSrc.filter((file) => file.endsWith('.spec.ts')), ...inTest];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
