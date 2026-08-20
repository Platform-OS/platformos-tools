import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assert, describe, expect, it } from 'vitest';

const packagesDir = join(__dirname, '..', '..', '..');

/**
 * Every workspace package that imports another one must declare it.
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

  /**
   * The workspace dependency graph is a DAG.
   */
  it('has no dependency cycle, so platformos-common can stay below the packages that own ASTs', async () => {
    const graph = new Map<string, string[]>();

    for (const dir of await workspacePackages()) {
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      graph.set(
        manifest.name,
        Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@platformos/')),
      );
    }

    expect(cycles(graph)).toEqual([]);
  });

  /**
   * THE CONTROL FOR BOTH. Every assertion above says a scan found nothing, and a scan that
   * found nothing because it scanned NOTHING says exactly the same thing — a moved `src`, a
   * renamed `packages/`, a `sourceFiles` that swallowed its own `readdir` error (it does,
   * deliberately, for packages with no `src`). Silence would then be permanent and total.
   */
  it('scans a real package and really reads its imports, so an empty result means something', async () => {
    const dirs = await workspacePackages();
    const checkCommon = dirs.find((dir) => dir.endsWith('platformos-check-common'));
    assert(checkCommon, `workspacePackages() found no platformos-check-common in ${packagesDir}`);

    const imported = await importedWorkspacePackages(join(checkCommon, 'src'));

    expect(imported.has('@platformos/platformos-common')).toBe(true);
  });

  /**
   * PRECISION MUST NOT COST DETECTION. `importedIn` requires import position, so every form the
   * repo actually uses is pinned here — otherwise a narrowing that silently stopped matching
   * `export * from` would make this whole guard vacuous while still reporting success.
   */
  it('matches every import form the workspace uses', () => {
    const pkg = '@platformos/platformos-common';

    for (const form of [
      `import { x } from '${pkg}';`,
      `import type { X } from '${pkg}';`,
      `import '${pkg}';`,
      `export * from '${pkg}';`,
      `export { x } from '${pkg}';`,
      `const m = await import('${pkg}');`,
      `const m = require('${pkg}');`,
      `import x from '${pkg}/app/uri';`,
    ]) {
      expect(importedIn(form), form).toEqual(new Set([pkg]));
    }
  });

  /**
   * And the case the old pattern got wrong: a package NAME used as data is not a dependency.
   */
  it('does not treat a package name used as data as an import', () => {
    const pkg = '@platformos/platformos-check-node';

    for (const mention of [
      `await createMockNodeModule(tempDir, '${pkg}', content);`,
      `expect(modulePaths).not.toContain('${pkg}');`,
      `const FIRST_PARTY = ['${pkg}'];`,
      `// '${pkg}' is excluded by name`,
    ]) {
      expect(importedIn(mention), mention).toEqual(new Set());
    }
  });

  /**
   * And the cycle detector itself sees one when there is one, which the repo must not have.
   */
  it('reports a cycle when the graph has one', () => {
    const graph = new Map([
      ['pkg-a', ['pkg-b']],
      ['pkg-b', ['pkg-c']],
      ['pkg-c', ['pkg-a']],
      // Enters the cycle from outside, and must not report it a second time.
      ['pkg-d', ['pkg-a']],
    ]);

    expect(cycles(graph)).toEqual(['pkg-a -> pkg-b -> pkg-c -> pkg-a']);
  });
});

/**
 * Every dependency cycle in `graph`, each spelled from its own smallest member so the
 * same cycle is reported once however many nodes a walk enters it from.
 */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[] {
  const found = new Set<string>();
  const onPath: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  function walk(node: string) {
    if (state.get(node) === 'done') return;

    if (state.get(node) === 'visiting') {
      const cycle = onPath.slice(onPath.indexOf(node));
      // Rotate to start at the smallest name: the same cycle reached from two entry
      // points is one problem and must not be reported as two.
      const pivot = cycle.indexOf([...cycle].sort()[0]);
      found.add([...cycle.slice(pivot), ...cycle.slice(0, pivot), cycle[pivot]].join(' -> '));
      return;
    }

    state.set(node, 'visiting');
    onPath.push(node);
    // A dependency on a package outside the workspace has no edges to follow.
    for (const dependency of graph.get(node) ?? []) walk(dependency);
    onPath.pop();
    state.set(node, 'done');
  }

  for (const node of graph.keys()) walk(node);
  return [...found].sort();
}

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

/**
 * The workspace packages `source` IMPORTS.
 *
 * Import POSITION is required — `from`, `import`, `import(` or `require(` — not merely a quoted
 * package name anywhere in the text. A package name is ordinary data: a fixture that creates a
 * mock `node_modules/@platformos/platformos-check-node` names it in a string, and so does an
 * assertion about one. Counting those made this guard demand a dependency on a package the file
 * only ever mentions, which is a false positive with nowhere to go — the honest fix is not to
 * declare a dependency that does not exist, and not to obfuscate the string either.
 *
 * Verified not to lose anything: over every package's `src`, the narrowed pattern finds the same
 * set as the old one, with a single difference — this file's own assertion below, which names
 * platformos-common in an `expect` and which the caller skips anyway as a self-reference.
 * `matchesEveryImportForm` pins the forms so precision cannot quietly cost detection.
 */
export function importedIn(source: string): Set<string> {
  const imported = new Set<string>();
  for (const [, specifier] of source.matchAll(WORKSPACE_IMPORT)) imported.add(specifier);
  return imported;
}

const WORKSPACE_IMPORT =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](@platformos\/[a-z0-9-]+)['"/]/g;

async function importedWorkspacePackages(srcDir: string): Promise<Set<string>> {
  const imported = new Set<string>();

  for (const file of await sourceFiles(srcDir)) {
    for (const specifier of importedIn(await readFile(file, 'utf8'))) {
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
