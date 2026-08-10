import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePosixPath } from '../os-path';

const packageRoot = join(__dirname, '..', '..');

/**
 * The App model exists in this package precisely BECAUSE this package sits below the
 * parser stack: that is what forces parsers to be injected, and injection is what lets
 * the language server, the linter and the graph share one set of file objects instead
 * of three. These tests pin that boundary, because the model silently stops being
 * shareable the moment it depends on something above it.
 *
 * "Below the parser stack" is about the WORKSPACE packages that own the ASTs
 * (`@platformos/liquid-html-parser` and friends) and about staying browser-safe — not
 * about never reading a format. This package owns platformOS domain facts that are
 * DEFINED in a format: a schema's model `name:` is YAML, a GraphQL operation's target
 * table is GraphQL. So `js-yaml` and `graphql` are dependencies, both browser-safe and
 * neither a workspace package, and `App` still receives every parser by injection.
 *
 * The list is exact rather than a denylist: a new dependency has to be justified here,
 * where the reason is written down, instead of appearing by hoisting.
 *
 * TAKING `@platformos/liquid-html-parser` WAS MEASURED AND REJECTED (TASK-74, 2026-08-09),
 * and the reason is not the one you would expect. It is not that the edge is expensive:
 * that package has no workspace dependencies of its own, it is browser-safe, and a spike
 * that added it here cost `+881 bytes` on the web extension's bundle — 0.010 % — with no
 * measurable CPU change and byte-identical offenses across the four `~/projects/pos`
 * baseline projects. It is that the edge buys nothing.
 *
 * `ast` being `unknown` is not a limitation this package works around; it is the evidence
 * that the design does not need the parser. `derived(key, compute)` already memoizes
 * analyses this package cannot name, dropped by the same two lines that drop the parse —
 * `undefinedVariablesOf` is the worked example — and the checks that parse a project file
 * themselves do it by not LOOKING THE FILE UP, which injection has nothing to do with.
 *
 * The one thing the dependency would buy is a TYPED `ast`, and that is not a one-package
 * move: the YAML and JSON ASTs are `JSONNode`, which lives in check-common. So opening this
 * list means moving jsonc and yaml down too, which is a different and larger decision than
 * the one this comment declines.
 */
describe('platformos-common package boundaries', () => {
  it('depends on no workspace parser package and no Node-only package', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

    expect(Object.keys(manifest.dependencies)).toEqual(['graphql', 'js-yaml', 'vscode-uri']);
  });

  /**
   * The list above pins which dependencies are DECLARED; this pins that each one is
   * actually imported. Both halves are needed, and only the first one existed:
   * `vscode-json-languageservice` sat in the manifest — and therefore in this file's
   * expected list, reviewed and re-approved every time the list changed — while nothing
   * in `src/` had ever imported it. An exact list makes an unjustified dependency
   * visible; it cannot make an unused one visible, because a name in two places that
   * agree is not evidence about a third.
   */
  it('imports every dependency it declares, so an unused one cannot sit in the manifest', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const specifiers = new Set<string>();

    for (const file of await sourceFiles(join(packageRoot, 'src'))) {
      const source = await readFile(file, 'utf8');
      for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
        specifiers.add(specifier);
      }
    }

    // A subpath import (`graphql/language`) counts as using `graphql`.
    const isImported = (dependency: string) =>
      [...specifiers].some((s) => s === dependency || s.startsWith(`${dependency}/`));

    expect(Object.keys(manifest.dependencies).filter((d) => !isImported(d))).toEqual([]);
  });

  it('imports nothing from Node, so the package stays browser-safe', async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles(join(packageRoot, 'src'))) {
      if (file.endsWith('.spec.ts')) continue;
      const source = await readFile(file, 'utf8');
      for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
        if (/^(node:|fs$|fs\/|path$|os$|url$|crypto$|child_process$)/.test(specifier)) {
          offenders.push(`${relativePosixPath(file, packageRoot)} imports '${specifier}'`);
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
