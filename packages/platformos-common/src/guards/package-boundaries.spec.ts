import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relativePosixPath } from '../os-path';

const packageRoot = join(__dirname, '..', '..');

/**
 * The App model exists in this package precisely BECAUSE this package sits below the parser
 * stack: that is what forces parsers to be injected, and injection is what lets the language
 * server, the linter and the graph share one set of file objects instead of three. These tests
 * pin that boundary, because the model silently stops being shareable the moment it depends on
 * something above it.
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
