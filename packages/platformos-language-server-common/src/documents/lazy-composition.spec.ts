import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App, Parsers, SourceCodeType } from '@platformos/platformos-common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentManager } from './DocumentManager';
import { AugmentedSourceCode } from './types';

const packageRoot = join(__dirname, '..', '..');

/**
 * Building the language server's view of a file must not read the file's AST.
 *
 * `{ ...sourceCode, textDocument }` did exactly that: spreading evaluates getters,
 * so it parsed every file in the workspace to copy the result. That is invisible
 * while sources are eager, and it silently destroys the lazy `AppFile` the rest of
 * this epic is built on — which is why it is pinned here rather than trusted.
 */
describe('language server file composition', () => {
  it('does not read ast when attaching textDocument to a lazily-parsed file', async () => {
    const parse = vi.fn((source: string) => ({ kind: 'liquid', source }));
    const parsers: Parsers = { [SourceCodeType.LiquidHtml]: parse };
    const uri = 'file:///project/app/views/partials/card.liquid';
    const app = App.fromPaths(
      'file:///project',
      [uri],
      {
        readFile: async () => '<b>card</b>',
        stat: async () => {
          throw new Error('not used');
        },
        readDirectory: async () => [],
      },
      parsers,
    );
    const file = app.get(uri)!;
    await file.load();

    // The composition DocumentManager performs, applied to a lazy file.
    const composed = attachLike(file, { textDocument: {} as never });

    expect(parse).not.toHaveBeenCalled();
    expect(composed.uri).toBe(uri);

    // Reading ast through the composed object still works, and parses exactly once.
    expect((composed as unknown as { ast: unknown }).ast).toEqual({
      kind: 'liquid',
      source: '<b>card</b>',
    });
    expect(parse.mock.calls.length).toBe(1);
  });

  it('spreads no source object anywhere in the package', async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles(join(packageRoot, 'src'))) {
      if (file.endsWith('.spec.ts')) continue;
      const source = await readFile(file, 'utf8');
      const code = source
        .split('\n')
        // Comments talk ABOUT the spread; only real code counts.
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');

      for (const [match] of code.matchAll(
        /(\.\.\.(sourceCode|appFile|file|doc)\b)|Object\.assign\(\s*(sourceCode|appFile)\b/g,
      )) {
        offenders.push(`${file.slice(packageRoot.length + 1)}: ${match}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('still exposes textDocument and getLiquidDoc on the documents it manages', async () => {
    const manager = new DocumentManager();
    const uri = 'file:///project/app/views/partials/card.liquid';
    manager.open(uri, '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}', 1);

    const file = manager.get(uri) as AugmentedSourceCode;

    expect(file.type).toBe(SourceCodeType.LiquidHtml);
    expect(file.textDocument.getText()).toBe(
      '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}',
    );
    expect(file.version).toBe(1);
    expect(
      (await (file as Extract<AugmentedSourceCode, { getLiquidDoc: unknown }>).getLiquidDoc())
        ?.liquidDoc?.parameters,
    ).toEqual([expect.objectContaining({ name: 'title', type: 'string', required: true })]);
  });
});

/** The same composition `DocumentManager.augmentedSourceCode` performs. */
function attachLike<T extends object, E extends object>(target: T, extras: E): T & E {
  return Object.defineProperties(
    target,
    Object.fromEntries(
      Object.entries(extras).map(([key, value]) => [
        key,
        { value, enumerable: true, configurable: true, writable: true },
      ]),
    ),
  ) as T & E;
}

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
