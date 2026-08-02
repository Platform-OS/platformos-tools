import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packagesDir = join(__dirname, '..', '..', '..');

/**
 * Every workspace package that imports another one must declare it.
 *
 * Six packages did not, and resolved only because yarn hoists workspace packages
 * into the root `node_modules` — so `yarn build` and `yarn test` passed while a
 * consumer installing the published tarball got an unresolvable import. That is
 * latent on its own; it becomes load-bearing the moment `platformos-common` owns
 * the `App` model that check-common, check-node and the language server all read.
 *
 * The check lives here rather than in a script so it runs with the rest of the
 * suite, where a new undeclared import is caught by the person who added it.
 */
describe('workspace dependency declarations', () => {
  it('declares every @platformos/* package it imports', async () => {
    const undeclared: string[] = [];

    for (const dir of await workspacePackages()) {
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      const declared = new Set(
        Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies,
        }),
      );

      for (const imported of await importedWorkspacePackages(join(dir, 'src'))) {
        if (imported === manifest.name) continue;
        if (!declared.has(imported)) undeclared.push(`${manifest.name} imports ${imported}`);
      }
    }

    expect(undeclared.sort()).toEqual([]);
  });
});

async function workspacePackages(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(packagesDir, entry.name);
        return (await exists(join(dir, 'package.json'))) && (await exists(join(dir, 'src')))
          ? [dir]
          : [];
      }),
  );
  return dirs.flat();
}

async function importedWorkspacePackages(srcDir: string): Promise<Set<string>> {
  const imported = new Set<string>();

  for (const file of await sourceFiles(srcDir)) {
    const source = await readFile(file, 'utf8');
    for (const [, specifier] of source.matchAll(/['"](@platformos\/[a-z0-9-]+)['"/]/g)) {
      imported.add(specifier);
    }
  }

  return imported;
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
