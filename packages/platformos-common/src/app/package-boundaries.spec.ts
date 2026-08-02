import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(__dirname, '..', '..');

/**
 * The App model exists in this package precisely BECAUSE this package sits below
 * the parser stack: that is what forces parsers to be injected, and injection is
 * what lets the language server, the linter and the graph share one set of file
 * objects instead of three. These tests pin that boundary, because the model
 * silently stops being shareable the moment a parser gets imported directly.
 */
describe('platformos-common package boundaries', () => {
  it('depends on no parser and no Node-only package', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

    expect(Object.keys(manifest.dependencies)).toEqual([
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
          offenders.push(`${file.slice(packageRoot.length + 1)} imports '${specifier}'`);
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
