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
 */
describe('platformos-common package boundaries', () => {
  it('depends on no workspace parser package and no Node-only package', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

    expect(Object.keys(manifest.dependencies)).toEqual([
      'graphql',
      'js-yaml',
      'vscode-json-languageservice',
      'vscode-uri',
    ]);
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
