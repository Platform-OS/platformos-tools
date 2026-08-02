import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { AbstractFileSystem, FileStat, FileTuple, FileType } from '../AbstractFileSystem';
import { App } from '../app';
import { DocumentsLocator, DocumentType } from './DocumentsLocator';

const ROOT = 'file:///project';
const rootUri = URI.parse(ROOT);

/**
 * A filesystem over a fixed file list that counts what it was asked.
 *
 * The counts are the point: resolving a render target used to cost one `stat` per
 * candidate directory per CALL SITE — ~40,000 `stat` calls per whole-project run on
 * a 400-partial project — and the App's name index is supposed to replace that with
 * a lookup.
 */
class CountingFileSystem implements AbstractFileSystem {
  readonly stats: string[] = [];
  readonly reads: string[] = [];

  constructor(private readonly files: readonly string[]) {}

  async stat(uri: string): Promise<FileStat> {
    this.stats.push(uri);
    if (!this.files.includes(uri)) throw new Error(`ENOENT: ${uri}`);
    return { type: FileType.File, size: 0 };
  }

  async readFile(uri: string): Promise<string> {
    this.reads.push(uri);
    return '';
  }

  async readDirectory(uri: string): Promise<FileTuple[]> {
    return this.files
      .filter((file) => file.startsWith(`${uri}/`))
      .map((file) => [file, FileType.File]);
  }
}

const uri = (relativePath: string) => `${ROOT}/${relativePath}`;

describe('DocumentsLocator resolution through the App index', () => {
  const files = [
    uri('app/views/partials/ui/card.liquid'),
    uri('app/lib/commands/create.liquid'),
    uri('app/graphql/user/find.graphql'),
    uri('modules/core/public/views/partials/badge.liquid'),
  ];

  const withApp = () => {
    const fs = new CountingFileSystem(files);
    const app = App.fromPaths(ROOT, files, fs);
    return { fs, locator: new DocumentsLocator(fs, app) };
  };

  it('resolves a partial, a function and a graphql file with no filesystem access', async () => {
    const { fs, locator } = withApp();

    expect(await locator.locate(rootUri, 'render', 'ui/card')).toBe(
      uri('app/views/partials/ui/card.liquid'),
    );
    expect(await locator.locate(rootUri, 'function', 'commands/create')).toBe(
      uri('app/lib/commands/create.liquid'),
    );
    expect(await locator.locate(rootUri, 'graphql', 'user/find')).toBe(
      uri('app/graphql/user/find.graphql'),
    );
    expect(await locator.locate(rootUri, 'render', 'modules/core/badge')).toBe(
      uri('modules/core/public/views/partials/badge.liquid'),
    );

    expect(fs.stats).toEqual([]);
    expect(fs.reads).toEqual([]);
  });

  it('falls back to the candidate walk for a name the app does not have', async () => {
    const { fs, locator } = withApp();

    expect(await locator.locate(rootUri, 'render', 'ghost')).toBe(undefined);
    // Both partial directories, each in its plain and `.html` spelling. Bounded on
    // purpose: enumerating every known format would make this 26 stats.
    expect(fs.stats).toEqual([
      uri('app/views/partials/ghost.liquid'),
      uri('app/views/partials/ghost.html.liquid'),
      uri('app/lib/ghost.liquid'),
      uri('app/lib/ghost.html.liquid'),
    ]);
  });

  it('falls back to the candidate walk for assets, which the lint app does not collect', async () => {
    // The glob that builds the app only collects Liquid, GraphQL and YAML, so an
    // asset is never in the index. Without the fallback every `{% asset %}` would
    // resolve to "missing".
    const assetUri = uri('app/assets/theme.css');
    const fs = new CountingFileSystem([assetUri]);
    const app = App.fromPaths(ROOT, [], fs);
    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'theme.css')).toBe(assetUri);
    expect(fs.stats).toEqual([assetUri]);
  });

  it('finds a file that exists only as an unsaved buffer', async () => {
    const fs = new CountingFileSystem([]);
    const app = App.fromPaths(ROOT, [], fs);
    const newUri = uri('app/views/partials/fresh.liquid');
    app.setSource(newUri, '<b>fresh</b>', 0);

    expect(await new DocumentsLocator(fs, app).locate(rootUri, 'render', 'fresh')).toBe(newUri);
    expect(fs.stats).toEqual([]);
  });
});

describe('the index and the candidate walk agree', () => {
  /**
   * The walk encodes precedence as "first candidate path that exists wins"; the index
   * encodes it as a position in the same candidate list. If those ever disagree, the
   * two resolvers answer with different files for the same name — the exact class of
   * bug the App model exists to stop reintroducing.
   */
  const cases: { name: string; files: string[]; lookups: [DocumentType, string][] }[] = [
    {
      name: 'an app-level partial, a module original, and an app/modules overwrite of the same name',
      files: [
        'app/views/partials/card.liquid',
        'modules/core/public/views/partials/card.liquid',
        'app/modules/core/public/views/partials/card.liquid',
      ],
      lookups: [
        ['render', 'card'],
        ['render', 'modules/core/card'],
      ],
    },
    {
      name: 'views/partials against lib for the same name',
      files: ['app/lib/thing.liquid', 'app/views/partials/thing.liquid'],
      lookups: [
        ['render', 'thing'],
        ['function', 'thing'],
      ],
    },
    {
      name: 'a module original with no overwrite',
      files: ['modules/core/private/lib/helper.liquid'],
      lookups: [['function', 'modules/core/helper']],
    },
    {
      name: 'public against private within one module',
      files: [
        'modules/core/private/views/partials/badge.liquid',
        'modules/core/public/views/partials/badge.liquid',
      ],
      lookups: [['render', 'modules/core/badge']],
    },
    {
      name: 'graphql under both graphql/ and graph_queries/',
      files: ['app/graph_queries/find.graphql', 'app/graphql/find.graphql'],
      lookups: [['graphql', 'find']],
    },
  ];

  for (const { name, files, lookups } of cases) {
    it(`resolves identically for ${name}`, async () => {
      const uris = files.map(uri);
      const fs = new CountingFileSystem(uris);
      const walkOnly = new DocumentsLocator(fs);
      const indexed = new DocumentsLocator(fs, App.fromPaths(ROOT, uris, fs));

      for (const [documentType, lookup] of lookups) {
        expect([lookup, await indexed.locate(rootUri, documentType, lookup)]).toEqual([
          lookup,
          await walkOnly.locate(rootUri, documentType, lookup),
        ]);
      }
    });
  }
});

describe('DocumentsLocator.list', () => {
  it('still enumerates directories, so completions are unchanged', async () => {
    const uris = [
      uri('app/views/partials/ui/card.liquid'),
      uri('app/views/partials/ui/badge.liquid'),
      uri('app/lib/commands/create.liquid'),
    ];
    const fs = new CountingFileSystem(uris);
    const app = App.fromPaths(ROOT, uris, fs);

    const withIndex = await new DocumentsLocator(fs, app).list(rootUri, 'render', '');
    const withoutIndex = await new DocumentsLocator(fs).list(rootUri, 'render', '');

    expect(withIndex).toEqual(withoutIndex);
    expect(withIndex).toEqual(['commands/create', 'ui/badge', 'ui/card']);
  });
});
