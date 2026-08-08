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

  /**
   * The workspace dependency graph is a DAG.
   *
   * The test above pins that an import is declared; it says nothing about the SHAPE of
   * what gets declared, and the two failures are different. An undeclared import breaks
   * a consumer installing the tarball. A cycle breaks the repository: `tsc -b` cannot
   * order the build, `yarn workspaces run build` cannot order the packages, and the one
   * property `package-boundaries.spec.ts` exists to protect — that `platformos-common`
   * sits BELOW everything that owns an AST, which is what lets the linter, the language
   * server and the graph share one set of file objects — stops being expressible at all.
   *
   * Over `dependencies` only, and that is the point rather than an omission. A runtime
   * dependency is what a published package carries and what decides build order; a
   * devDependency is a sibling borrowed for a test (`platformos-graph`'s `src/` test
   * helper imports `platformos-check-node`), and a monorepo may legitimately grow a
   * cycle in those. Measured on 2026-08-09, the graph is acyclic under BOTH readings, so
   * the narrower rule hides nothing today — it is chosen so that a legitimate test-only
   * edge tomorrow does not fail a check about published shape.
   *
   * The message names the whole cycle, because the edge to delete is rarely the one the
   * error is reported on.
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
