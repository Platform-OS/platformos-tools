import { describe, expect, it, vi } from 'vitest';
import { AbstractFileSystem, FileStat, FileTuple, FileType } from '../AbstractFileSystem';
import { PlatformOSFileType } from '../path-utils';
import { App } from './App';
import { AssetFile, LayoutFile, PageFile, PartialFile, TranslationFile } from './AppFile';
import { Parsers, SourceCodeType } from './types';

const ROOT = 'file:///project';

/** An `fs` that counts its reads, so laziness can be asserted rather than assumed. */
class CountingFileSystem implements AbstractFileSystem {
  readonly reads: string[] = [];

  constructor(private readonly files: Record<string, string> = {}) {}

  async readFile(uri: string): Promise<string> {
    this.reads.push(uri);
    const source = this.files[uri];
    if (source === undefined) throw new Error(`ENOENT: ${uri}`);
    return source;
  }

  async stat(): Promise<FileStat> {
    throw new Error('stat should not be called');
  }

  async readDirectory(): Promise<FileTuple[]> {
    throw new Error('readDirectory should not be called');
  }
}

/** An `fs` whose every operation throws, to prove construction does no I/O. */
const explodingFs: AbstractFileSystem = {
  readFile: () => {
    throw new Error('readFile should not be called');
  },
  stat: () => {
    throw new Error('stat should not be called');
  },
  readDirectory: () => {
    throw new Error('readDirectory should not be called');
  },
};

const uri = (relativePath: string) => `${ROOT}/${relativePath}`;

const trivialParsers = (): Parsers => ({
  [SourceCodeType.LiquidHtml]: (source) => ({ kind: 'liquid', source }),
  [SourceCodeType.YAML]: (source) => ({ kind: 'yaml', source }),
  [SourceCodeType.GraphQL]: (source) => ({ kind: 'graphql', source }),
});

describe('App.fromPaths', () => {
  it('performs no I/O, however many paths it classifies', () => {
    const uris = Array.from({ length: 5000 }, (_, i) => uri(`app/views/partials/p${i}.liquid`));

    const app = App.fromPaths(ROOT, uris, explodingFs);

    expect(app.size).toBe(5000);
    expect(app.find(PlatformOSFileType.Partial, 'p4999')!.uri).toBe(
      uri('app/views/partials/p4999.liquid'),
    );
  });

  it('drops paths that are not in a recognized platformOS directory', () => {
    const app = App.fromPaths(
      ROOT,
      [
        uri('app/views/partials/card.liquid'),
        uri('scripts/helper.liquid'),
        uri('modules/core/generators/templates/lib/create.liquid'),
      ],
      explodingFs,
    );

    expect(app.all().map((file) => file.relativePath)).toEqual(['app/views/partials/card.liquid']);
  });

  it('builds the AppFile subclass matching each file type', () => {
    const app = App.fromPaths(
      ROOT,
      [
        uri('app/views/partials/card.liquid'),
        uri('app/views/pages/index.liquid'),
        uri('app/views/layouts/application.liquid'),
        uri('app/translations/en.yml'),
        uri('app/assets/theme.css'),
      ],
      explodingFs,
    );

    expect(app.get(uri('app/views/partials/card.liquid'))).toBeInstanceOf(PartialFile);
    expect(app.get(uri('app/views/pages/index.liquid'))).toBeInstanceOf(PageFile);
    expect(app.get(uri('app/views/layouts/application.liquid'))).toBeInstanceOf(LayoutFile);
    expect(app.get(uri('app/translations/en.yml'))).toBeInstanceOf(TranslationFile);
    expect(app.get(uri('app/assets/theme.css'))).toBeInstanceOf(AssetFile);
  });
});

describe('AppFile.name', () => {
  const nameOf = (relativePath: string) =>
    App.fromPaths(ROOT, [uri(relativePath)], explodingFs).get(uri(relativePath))!.name;

  it('strips the type directory and the extension for app-level files', () => {
    expect(nameOf('app/views/partials/ui/card.liquid')).toBe('ui/card');
    expect(nameOf('app/lib/commands/create.liquid')).toBe('commands/create');
    expect(nameOf('app/graphql/user/find.graphql')).toBe('user/find');
    expect(nameOf('app/views/layouts/application.liquid')).toBe('application');
    expect(nameOf('app/views/pages/blog/index.liquid')).toBe('blog/index');
  });

  it('prefixes module files with modules/<name>/, from both module roots', () => {
    expect(nameOf('modules/core/public/views/partials/card.liquid')).toBe('modules/core/card');
    expect(nameOf('modules/core/private/lib/helper.liquid')).toBe('modules/core/helper');
    expect(nameOf('app/modules/core/public/views/partials/card.liquid')).toBe('modules/core/card');
    expect(nameOf('app/modules/core/private/graphql/find.graphql')).toBe('modules/core/find');
  });

  it('keeps the extension for assets, because that is how they are referenced', () => {
    expect(nameOf('app/assets/styles/theme.css')).toBe('styles/theme.css');
    expect(nameOf('modules/core/public/assets/app.js')).toBe('modules/core/app.js');
  });

  it('removes only the last extension, so a .json.liquid page keeps its .json', () => {
    expect(nameOf('app/views/pages/api/users.json.liquid')).toBe('api/users.json');
  });
});

describe('App.find', () => {
  it('resolves without any filesystem access', () => {
    const fs = new CountingFileSystem();
    const app = App.fromPaths(ROOT, [uri('app/views/partials/ui/card.liquid')], fs);

    expect(app.find(PlatformOSFileType.Partial, 'ui/card')!.relativePath).toBe(
      'app/views/partials/ui/card.liquid',
    );
    expect(fs.reads).toEqual([]);
  });

  it('lets an app/modules overwrite shadow its modules original', () => {
    const original = uri('modules/core/public/views/partials/card.liquid');
    const overwrite = uri('app/modules/core/public/views/partials/card.liquid');
    const app = App.fromPaths(ROOT, [original, overwrite], explodingFs);

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')!.uri).toBe(overwrite);
  });

  it('shadows regardless of the order the paths were classified in', () => {
    const original = uri('modules/core/public/views/partials/card.liquid');
    const overwrite = uri('app/modules/core/public/views/partials/card.liquid');
    const app = App.fromPaths(ROOT, [overwrite, original], explodingFs);

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')!.uri).toBe(overwrite);
  });

  it('prefers views/partials over lib, the order the candidate paths are walked in', () => {
    const app = App.fromPaths(
      ROOT,
      [uri('app/lib/card.liquid'), uri('app/views/partials/card.liquid')],
      explodingFs,
    );

    expect(app.find(PlatformOSFileType.Partial, 'card')!.relativePath).toBe(
      'app/views/partials/card.liquid',
    );
  });

  it('prefers public over private within a module', () => {
    const app = App.fromPaths(
      ROOT,
      [
        uri('modules/core/private/views/partials/card.liquid'),
        uri('modules/core/public/views/partials/card.liquid'),
      ],
      explodingFs,
    );

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')!.relativePath).toBe(
      'modules/core/public/views/partials/card.liquid',
    );
  });

  it('returns undefined for a name the app does not have', () => {
    const app = App.fromPaths(ROOT, [uri('app/views/partials/card.liquid')], explodingFs);

    expect(app.find(PlatformOSFileType.Partial, 'nope')).toBe(undefined);
  });
});

describe('App.load', () => {
  it('reads a file at most once, however many callers await it', async () => {
    const target = uri('app/views/partials/card.liquid');
    const fs = new CountingFileSystem({ [target]: '<b>card</b>' });
    const app = App.fromPaths(ROOT, [target], fs);
    const file = app.get(target)!;

    await Promise.all([file.load(), file.load(), app.load([target])]);
    await file.load();

    expect(fs.reads).toEqual([target]);
    expect(file.source).toBe('<b>card</b>');
  });

  it('reads only the files it was asked for', async () => {
    const card = uri('app/views/partials/card.liquid');
    const other = uri('app/views/partials/other.liquid');
    const fs = new CountingFileSystem({ [card]: 'card', [other]: 'other' });
    const app = App.fromPaths(ROOT, [card, other], fs);

    await app.load([card]);

    expect(fs.reads).toEqual([card]);
  });

  it('parses at most once per version, and makes ast readable synchronously', async () => {
    const target = uri('app/views/partials/card.liquid');
    const fs = new CountingFileSystem({ [target]: 'card' });
    const parser = vi.fn((source: string) => ({ kind: 'liquid', source }));
    const app = App.fromPaths(ROOT, [target], fs, { [SourceCodeType.LiquidHtml]: parser });
    const file = app.get(target)!;

    await file.load();
    const first = file.ast;
    const second = file.ast;

    expect(first).toBe(second);
    expect(parser.mock.calls).toEqual([['card', target]]);
  });

  it('throws a source-read-before-load error rather than reporting empty contents', () => {
    const target = uri('app/views/partials/card.liquid');
    const app = App.fromPaths(ROOT, [target], new CountingFileSystem({ [target]: 'card' }));

    expect(() => app.get(target)!.source).toThrowError(
      `AppFile source read before it was loaded: ${target}. ` +
        `Await load() (or App.load()) for every file you intend to read.`,
    );
  });
});

describe('AppFile.ast parse failures', () => {
  const exploding = (message: string) => (): never => {
    throw new Error(message);
  };

  it.each([
    ['liquid', 'app/views/partials/card.liquid', SourceCodeType.LiquidHtml],
    ['yaml', 'app/translations/en.yml', SourceCodeType.YAML],
    ['graphql', 'app/graphql/find.graphql', SourceCodeType.GraphQL],
  ] as const)('captures a %s parse error as an Error value on ast', async (kind, path, type) => {
    const target = uri(path);
    const fs = new CountingFileSystem({ [target]: 'nonsense' });
    const app = App.fromPaths(ROOT, [target], fs, { [type]: exploding(`bad ${kind}`) });
    const file = app.get(target)!;

    await file.load();

    expect(file.ast).toEqual(new Error(`bad ${kind}`));
  });

  it('captures an Error a parser RETURNS, unchanged', async () => {
    const target = uri('app/views/partials/card.liquid');
    const returned = new Error('unclosed tag');
    const fs = new CountingFileSystem({ [target]: '{% if %}' });
    const app = App.fromPaths(ROOT, [target], fs, {
      [SourceCodeType.LiquidHtml]: () => returned,
    });

    const file = app.get(target)!;
    await file.load();

    expect(file.ast).toBe(returned);
  });

  it('reports a missing parser as an Error value', async () => {
    const target = uri('app/views/partials/card.liquid');
    const fs = new CountingFileSystem({ [target]: 'card' });
    const app = App.fromPaths(ROOT, [target], fs, {});
    const file = app.get(target)!;

    await file.load();

    expect(file.ast).toEqual(new Error(`No parser registered for ${target}`));
  });
});

describe('App.setSource', () => {
  it('bumps the version and drops the cached parse', async () => {
    const target = uri('app/views/partials/card.liquid');
    const fs = new CountingFileSystem({ [target]: 'on disk' });
    const app = App.fromPaths(ROOT, [target], fs, trivialParsers());
    const file = app.get(target)!;

    await file.load();
    expect(file.ast).toEqual({ kind: 'liquid', source: 'on disk' });
    expect(file.version).toBe(undefined);

    app.setSource(target, 'in buffer', 7);

    expect(file.version).toBe(7);
    expect(file.source).toBe('in buffer');
    expect(file.ast).toEqual({ kind: 'liquid', source: 'in buffer' });
    expect(fs.reads).toEqual([target]);
  });

  it('adds a file that does not exist on disk yet', () => {
    const app = App.fromPaths(ROOT, [], explodingFs, trivialParsers());
    const target = uri('app/views/partials/new.liquid');

    const file = app.setSource(target, 'fresh');

    expect(file!.source).toBe('fresh');
    expect(app.find(PlatformOSFileType.Partial, 'new')).toBe(file);
  });

  it('refuses a URI that is not in a recognized platformOS directory', () => {
    const app = App.fromPaths(ROOT, [], explodingFs);

    expect(app.setSource(uri('scripts/helper.liquid'), 'x')).toBe(undefined);
    expect(app.size).toBe(0);
  });

  it('wins over a read that was already in flight', async () => {
    const target = uri('app/views/partials/card.liquid');
    let release: (source: string) => void;
    const fs: AbstractFileSystem = {
      readFile: () => new Promise<string>((resolve) => (release = resolve)),
      stat: explodingFs.stat,
      readDirectory: explodingFs.readDirectory,
    };
    const app = App.fromPaths(ROOT, [target], fs, trivialParsers());
    const file = app.get(target)!;

    const loading = file.load();
    app.setSource(target, 'in buffer', 1);
    release!('on disk');
    await loading;

    expect(file.source).toBe('in buffer');
  });
});

describe('App.invalidate', () => {
  it('drops the source and the parse so the next load goes back to disk', async () => {
    const target = uri('app/views/partials/card.liquid');
    const fs = new CountingFileSystem({ [target]: 'first' });
    const app = App.fromPaths(ROOT, [target], fs, trivialParsers());
    const file = app.get(target)!;

    await file.load();
    app.invalidate(target);

    expect(file.loaded).toBe(false);
    expect(file.loadedSource).toBe(undefined);

    await file.load();

    expect(fs.reads).toEqual([target, target]);
    expect(file.ast).toEqual({ kind: 'liquid', source: 'first' });
  });
});

describe('App.update', () => {
  it('re-indexes only the named URIs, leaving other files parsed', async () => {
    const card = uri('app/views/partials/card.liquid');
    const other = uri('app/views/partials/other.liquid');
    const fs = new CountingFileSystem({ [card]: 'card', [other]: 'other' });
    const app = App.fromPaths(ROOT, [card, other], fs, trivialParsers());

    await app.load();
    const otherAstBefore = app.get(other)!.ast;

    app.update([card]);

    expect(app.get(other)!.ast).toBe(otherAstBefore);
    expect(app.get(card)!.loaded).toBe(false);
  });

  it('adds a file the app did not have', () => {
    const app = App.fromPaths(ROOT, [], explodingFs);
    const added = uri('app/views/partials/card.liquid');

    app.update([added]);

    expect(app.find(PlatformOSFileType.Partial, 'card')!.uri).toBe(added);
  });
});

describe('App.remove', () => {
  const original = uri('modules/core/public/views/partials/card.liquid');
  const overwrite = uri('app/modules/core/public/views/partials/card.liquid');

  it('restores the shadowed original when the overwrite goes away', () => {
    const app = App.fromPaths(ROOT, [original, overwrite], explodingFs);

    app.remove([overwrite]);

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')!.uri).toBe(original);
    expect(app.has(overwrite)).toBe(false);
  });

  it('keeps the overwrite resolving when the original goes away', () => {
    const app = App.fromPaths(ROOT, [original, overwrite], explodingFs);

    app.remove([original]);

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')!.uri).toBe(overwrite);
  });

  it('forgets the name entirely once every candidate is gone', () => {
    const app = App.fromPaths(ROOT, [original, overwrite], explodingFs);

    app.remove([original, overwrite]);

    expect(app.find(PlatformOSFileType.Partial, 'modules/core/card')).toBe(undefined);
    expect(app.size).toBe(0);
  });
});

describe('App.fromSources', () => {
  it('starts every file loaded, reading nothing', () => {
    const app = App.fromSources(
      ROOT,
      {
        'app/views/partials/card.liquid': '<b>card</b>',
        'app/translations/en.yml': 'en:\n  hi: Hi',
      },
      explodingFs,
      trivialParsers(),
    );

    expect(app.all().map((file) => file.source)).toEqual(['<b>card</b>', 'en:\n  hi: Hi']);
    expect(app.get(uri('app/views/partials/card.liquid'))!.ast).toEqual({
      kind: 'liquid',
      source: '<b>card</b>',
    });
  });
});

describe('module shadowing metadata', () => {
  it('reports the counterpart URI of an overwrite and of an original', () => {
    const original = uri('modules/core/public/views/partials/card.liquid');
    const overwrite = uri('app/modules/core/public/views/partials/card.liquid');
    const app = App.fromPaths(ROOT, [original, overwrite], explodingFs);

    expect(app.get(original)!.isModuleOriginal).toBe(true);
    expect(app.get(original)!.isModuleOverwrite).toBe(false);
    expect(app.get(original)!.moduleOverwriteUri).toBe(overwrite);
    expect(app.get(original)!.moduleOriginalUri).toBe(undefined);

    expect(app.get(overwrite)!.isModuleOverwrite).toBe(true);
    expect(app.get(overwrite)!.isModuleOriginal).toBe(false);
    expect(app.get(overwrite)!.moduleOriginalUri).toBe(original);
    expect(app.get(overwrite)!.moduleOverwriteUri).toBe(undefined);
  });

  it('leaves app-level files without any module identity', () => {
    const target = uri('app/views/partials/card.liquid');
    const file = App.fromPaths(ROOT, [target], explodingFs).get(target)!;

    expect(file.moduleName).toBe(undefined);
    expect(file.isModuleOriginal).toBe(false);
    expect(file.isModuleOverwrite).toBe(false);
  });
});

describe('App queries', () => {
  const app = () =>
    App.fromPaths(
      ROOT,
      [
        uri('app/views/partials/card.liquid'),
        uri('app/lib/commands/create.liquid'),
        uri('app/views/pages/index.liquid'),
        uri('app/views/layouts/application.liquid'),
        uri('app/translations/en.yml'),
        uri('app/graphql/find.graphql'),
        uri('app/assets/theme.css'),
      ],
      explodingFs,
    );

  it('groups files by platformOS type', () => {
    expect(
      app()
        .partials()
        .map((file) => file.name),
    ).toEqual(['card', 'commands/create']);
    expect(
      app()
        .pages()
        .map((file) => file.name),
    ).toEqual(['index']);
    expect(
      app()
        .layouts()
        .map((file) => file.name),
    ).toEqual(['application']);
    expect(
      app()
        .translations()
        .map((file) => file.name),
    ).toEqual(['en']);
    expect(
      app()
        .graphqls()
        .map((file) => file.name),
    ).toEqual(['find']);
    expect(
      app()
        .assets()
        .map((file) => file.name),
    ).toEqual(['theme.css']);
  });

  it('reports source-code types from extensions, and excludes files no check models', () => {
    expect(
      app()
        .all()
        .map((file) => [file.relativePath, file.type]),
    ).toEqual([
      ['app/views/partials/card.liquid', SourceCodeType.LiquidHtml],
      ['app/lib/commands/create.liquid', SourceCodeType.LiquidHtml],
      ['app/views/pages/index.liquid', SourceCodeType.LiquidHtml],
      ['app/views/layouts/application.liquid', SourceCodeType.LiquidHtml],
      ['app/translations/en.yml', SourceCodeType.YAML],
      ['app/graphql/find.graphql', SourceCodeType.GraphQL],
      ['app/assets/theme.css', undefined],
    ]);

    expect(
      app()
        .sourceCodes()
        .map((file) => file.relativePath),
    ).toEqual([
      'app/views/partials/card.liquid',
      'app/lib/commands/create.liquid',
      'app/views/pages/index.liquid',
      'app/views/layouts/application.liquid',
      'app/translations/en.yml',
      'app/graphql/find.graphql',
    ]);
  });
});

describe('JSON is not a platformOS source type', () => {
  it('gives a stray .json file no source-code type, so nothing parses it', () => {
    // JSON responses come from `.json.liquid` pages, and the only .json files the
    // platform deploys are the two fixed asset manifests. Ruby's App::REGEXP_MAP
    // has no JSON entry either.
    const target = uri('app/assets/data.json');
    const app = App.fromPaths(ROOT, [target], explodingFs, trivialParsers());

    expect(app.get(target)!.type).toBe(undefined);
    expect(app.sourceCodes()).toEqual([]);
  });

  it('treats a .json.liquid page as Liquid', () => {
    const target = uri('app/views/pages/api/users.json.liquid');
    const app = App.fromPaths(ROOT, [target], explodingFs, trivialParsers());

    expect(app.get(target)!.type).toBe(SourceCodeType.LiquidHtml);
  });
});

describe('extension parsers', () => {
  it('parses a file no SourceCodeType covers through the extension map', async () => {
    const target = uri('app/assets/app.js');
    const fs = new CountingFileSystem({ [target]: 'export const a = 1;' });
    const app = App.fromPaths(ROOT, [target], fs, {
      extensions: { js: (source) => ({ kind: 'js', source }) },
    });
    const file = app.get(target)!;

    await file.load();

    expect(file.type).toBe(undefined);
    expect(file.ast).toEqual({ kind: 'js', source: 'export const a = 1;' });
  });
});

describe('classification fallback', () => {
  it('drops a file whose known directory is not anchored under the root', () => {
    // These contain `app/views/partials/` and `app/migrations/`, but neither is IN the
    // app: they are vendored copies and seed data, and the platform does not deploy
    // them. `getFileType` alone would claim both, because it matches a known directory
    // anywhere in a URI and has no root to anchor against.
    const app = App.fromPaths(
      ROOT,
      [
        'file:///project/vendor/app/views/partials/card.liquid',
        'file:///project/seed/post_import/app/migrations/20220517145452_rebuild.liquid',
        uri('app/views/partials/card.liquid'),
      ],
      explodingFs,
    );

    expect(app.all().map((file) => file.relativePath)).toEqual(['app/views/partials/card.liquid']);
  });

  it('ranks a file no candidate path covers below one that is covered', () => {
    const covered = uri('app/views/partials/card.liquid');
    const uncovered = uri('marketplace_builder/views/partials/card.liquid');
    const app = App.fromPaths(ROOT, [uncovered, covered], explodingFs);

    expect(app.find(PlatformOSFileType.Partial, 'card')!.uri).toBe(covered);
  });
});
