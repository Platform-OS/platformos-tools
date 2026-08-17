import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePosixPath, toPosixPath, uriFromPath, uriFromPathOrUri } from './os-path';

const packagesDir = join(__dirname, '..', '..');

/**
 * Windows-shaped inputs are asserted here rather than left to the Windows CI job,
 * because these are pure string functions: a `\`-separated path is the same input on
 * every platform, so the cases that used to break only on Windows are checkable
 * everywhere. `uriFromPath` is the one function whose OUTPUT could in principle differ
 * per platform (`URI.file` swaps separators only when it is running on Windows) —
 * `normalizeUri` is what closes that gap, and the drive-letter cases below pin it.
 */
describe('toPosixPath', () => {
  it('forward-slashes a Windows path', () => {
    expect(toPosixPath('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\app\\views\\home.liquid')).toBe(
      'C:/Users/RUNNER~1/AppData/Local/Temp/app/views/home.liquid',
    );
  });

  it('leaves a posix path alone', () => {
    expect(toPosixPath('/home/u/project/app/views/home.liquid')).toBe(
      '/home/u/project/app/views/home.liquid',
    );
  });

  it('collapses repeated separators and drops a trailing one', () => {
    expect(toPosixPath('/a//b/\\c\\')).toBe('/a/b/c');
  });

  it('keeps the two leading slashes of a Windows namespace', () => {
    expect(toPosixPath('\\\\?\\C:\\x')).toBe('//?/C:/x');
  });

  it('answers the degenerate inputs', () => {
    expect([toPosixPath(''), toPosixPath('/'), toPosixPath('\\'), toPosixPath('a')]).toEqual([
      '',
      '/',
      '/',
      'a',
    ]);
  });

  it('throws for a URI, whose slashes must not be collapsed', () => {
    expect(() => toPosixPath('file:///c:/Users/x')).toThrow(
      "toPosixPath takes a filesystem path, but got the URI 'file:///c:/Users/x'. " +
        'Use normalizeUri for a URI — collapsing its slashes would change what it points at.',
    );
  });
});

describe('relativePosixPath', () => {
  it('relativizes a Windows path against a posix-spelled base', () => {
    expect(
      relativePosixPath(
        'C:\\repo\\packages\\platformos-check-node\\src\\index.ts',
        'C:/repo/packages',
      ),
    ).toBe('platformos-check-node/src/index.ts');
  });

  it('relativizes a posix path', () => {
    expect(relativePosixPath('/repo/packages/a/src/x.ts', '/repo/packages')).toBe('a/src/x.ts');
  });

  it('is empty for the base itself', () => {
    expect(relativePosixPath('/repo/packages/', '/repo/packages')).toBe('');
  });

  it('returns the whole normalized path when it is not under the base', () => {
    expect(relativePosixPath('C:\\elsewhere\\x.ts', 'C:\\repo\\packages')).toBe(
      'C:/elsewhere/x.ts',
    );
  });

  it('matches the base only at a segment boundary', () => {
    expect(relativePosixPath('/repo/packages-old/x.ts', '/repo/packages')).toBe(
      '/repo/packages-old/x.ts',
    );
  });
});

describe('uriFromPath', () => {
  it('gives a Windows path the spelling the rest of the toolchain compares on', () => {
    // Not `file:///c%3A/…`, which is what `URI.file(path).toString()` produces and what
    // made a lint run and a buffer lint disagree about the same file on Windows.
    expect(uriFromPath('C:\\Users\\RUNNER~1\\Temp\\p\\app\\views\\pages\\home.liquid')).toBe(
      'file:///c:/Users/RUNNER~1/Temp/p/app/views/pages/home.liquid',
    );
  });

  it('gives a posix path a file:// URI', () => {
    expect(uriFromPath('/home/u/project/app/views/pages/home.liquid')).toBe(
      'file:///home/u/project/app/views/pages/home.liquid',
    );
  });
});

describe('uriFromPathOrUri', () => {
  it('treats a drive letter as a path, not a scheme', () => {
    expect(uriFromPathOrUri('c:\\project\\app\\x.liquid')).toBe('file:///c:/project/app/x.liquid');
  });

  it('normalizes a URI it is handed', () => {
    expect([
      uriFromPathOrUri('file:///c%3A/project/app/x.liquid'),
      uriFromPathOrUri('mock-fs:/app/x.liquid'),
      uriFromPathOrUri('file:///home/u/project/'),
    ]).toEqual([
      'file:///c:/project/app/x.liquid',
      'mock-fs:/app/x.liquid',
      'file:///home/u/project',
    ]);
  });
});

/**
 * One normalizer per spelling, and no package rolls its own.
 */
describe('path normalization has one owner', () => {
  /** The modules that own a spelling, and may therefore swap separators. */
  const OWNERS = new Set([
    // The path spelling, and this file, which quotes the patterns below.
    'platformos-common/src/os-path.ts',
    'platformos-common/src/os-path.spec.ts',
    // The URI spelling: `normalizeUri` forward-slashes a URI STRING, which is not a
    // path and must keep its `file:///` intact.
    'platformos-common/src/app/uri.ts',
    // `childUri` appends ONE directory-entry name to an already-normalized URI, and
    // has to treat that fragment exactly the way `normalizeUri` would to stay equal
    // to `join`. Its subject is a name, not a path.
    'platformos-check-common/src/path.ts',
  ]);

  const HACKS = [
    {
      what: 'a hand-rolled backslash-to-slash replace (use toPosixPath, or normalizeUri for a URI)',
      pattern: /\.replace\(\s*\/\[?\\\\\]?\/[a-z]*\s*,\s*(['"`])\/\1\s*\)/,
    },
    {
      what: 'an import of normalize-path (platformos-common owns that normalization now)',
      pattern: /(from|require\()\s*['"]normalize-path['"]/,
    },
  ];

  it('is never re-implemented in another package', async () => {
    const offenders: string[] = [];

    for (const dir of await workspacePackages()) {
      const scanned = (
        await Promise.all([sourceFiles(join(dir, 'src')), sourceFiles(join(dir, 'test'))])
      ).flat();
      for (const file of scanned) {
        const relative = relativePosixPath(file, packagesDir);
        if (OWNERS.has(relative)) continue;

        const source = await readFile(file, 'utf8');
        for (const { what, pattern } of HACKS) {
          if (pattern.test(source)) offenders.push(`${relative}: ${what}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});

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
      return Promise.resolve(/\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []);
    }),
  );
  return nested.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
