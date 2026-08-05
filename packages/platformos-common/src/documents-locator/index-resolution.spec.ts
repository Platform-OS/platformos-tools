import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { AbstractFileSystem, FileStat, FileTuple, FileType } from '../AbstractFileSystem';
import { App } from '../app';
import { PlatformOSFileType } from '../path-utils';
import { DocumentsLocator, DocumentType } from './DocumentsLocator';

const ROOT = 'file:///project';
const rootUri = URI.parse(ROOT);

/**
 * A filesystem over a fixed file list that counts what it was asked.
 *
 * The counts are the point: resolving a render target through the App's name index is a
 * lookup rather than one `stat` per candidate spelling per call site, and the miss path
 * costs one `readDirectory` per candidate DIRECTORY however many format spellings it
 * covers.
 */
class CountingFileSystem implements AbstractFileSystem {
  readonly stats: string[] = [];
  readonly reads: string[] = [];
  readonly listed: string[] = [];

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

  /** Shallow, like a real `readdir`: direct children only. */
  async readDirectory(uri: string): Promise<FileTuple[]> {
    this.listed.push(uri);
    const prefix = `${uri}/`;
    const entries = new Map<string, FileType>();
    for (const file of this.files) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const cut = rest.indexOf('/');
      if (cut === -1) entries.set(prefix + rest, FileType.File);
      else entries.set(prefix + rest.slice(0, cut), FileType.Directory);
    }
    if (entries.size === 0) throw new Error(`ENOENT: ${uri}`);
    return [...entries];
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

  it('falls back to the filesystem for a name the app does not have', async () => {
    const { fs, locator } = withApp();

    expect(await locator.locate(rootUri, 'render', 'ghost')).toBe(undefined);
    // One listing per candidate DIRECTORY, not a stat per candidate spelling —
    // which is what lets the miss path cover every response format at the I/O
    // cost of covering one.
    expect(fs.stats).toEqual([]);
    expect(fs.listed).toEqual([uri('app/views/partials'), uri('app/lib')]);
  });

  it('falls back to the filesystem for assets, which the lint app does not collect', async () => {
    // The walk that builds the app only collects Liquid, GraphQL and YAML, so an
    // asset is never in the index. Without the fallback every `{% asset %}` would
    // resolve to "missing".
    const assetUri = uri('app/assets/theme.css');
    const fs = new CountingFileSystem([assetUri]);
    const app = App.fromPaths(ROOT, [], fs);
    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'theme.css')).toBe(assetUri);
    expect(fs.listed).toEqual([uri('app/assets')]);
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
    {
      // The TASK-46.14 case: `pathToName` strips ANY known format, so the file's
      // name omits the `.csv` — and the filesystem path must resolve it under
      // that same name, or every caller without an index reports a file the
      // platform renders as missing.
      name: 'a partial whose file carries a response format',
      files: ['app/views/partials/theme/simple/admin/users/csv/index.csv.liquid'],
      lookups: [['render', 'theme/simple/admin/users/csv/index']],
    },
    {
      name: 'a format-carrying file against its plain sibling',
      files: ['app/views/partials/card.json.liquid', 'app/views/partials/card.liquid'],
      lookups: [['render', 'card']],
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

describe('DocumentsLocator and assets', () => {
  const asset = uri('app/assets/logo.png');

  /**
   * Assets never come from the index, even when the app holds them.
   *
   * Nothing in this toolchain reads an asset, so the only question ever asked about one
   * is whether it exists. The filesystem answers that in a way an index entry cannot go
   * stale on: the lint's project walk collects no assets and the language server's file
   * watcher does not cover them, so an index would keep resolving an image deleted
   * outside the editor.
   */
  it('asks the filesystem for an asset the app contains rather than answering from the index', async () => {
    const fs = new CountingFileSystem([asset]);
    const app = App.fromPaths(ROOT, [asset], fs);

    // Guard: the app really does hold it, so this proves a deliberate carve-out and
    // not an app that happens to be empty.
    expect(app.find(PlatformOSFileType.Asset, 'logo.png')?.uri).toBe(asset);

    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'logo.png')).toBe(asset);
    expect(fs.listed).toEqual([uri('app/assets')]);
  });

  it('reports an asset that is gone from disk but still in the app', async () => {
    const fs = new CountingFileSystem([]);
    const app = App.fromPaths(ROOT, [asset], fs);
    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'logo.png')).toBe(undefined);
  });
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
