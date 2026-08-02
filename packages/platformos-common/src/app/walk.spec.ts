import { describe, expect, it } from 'vitest';
import { AbstractFileSystem, FileStat, FileTuple, FileType } from '../AbstractFileSystem';
import { UnreadableDirectoryError, walkAppSourceFiles } from './walk';

const ROOT = 'file:///project';

/**
 * A tree-backed `fs` that behaves like the real ones in the two ways this walk
 * depends on: `readDirectory` returns FULL URIs, and a missing directory REJECTS.
 * Every implementation rejects differently (`ENOENT`, `FileNotFound`, a bare
 * `Error`), so the bare one is the least forgiving choice to test against.
 */
class TreeFileSystem implements AbstractFileSystem {
  readonly listed: string[] = [];
  /** Every error this fs raised, so a test can assert the wrapper kept the original. */
  readonly thrown: Error[] = [];

  constructor(
    private readonly files: string[],
    private readonly unreadable: string[] = [],
  ) {}

  async readDirectory(uri: string): Promise<FileTuple[]> {
    this.listed.push(uri);
    if (this.unreadable.includes(uri)) {
      const error = new Error(`EACCES: ${uri}`);
      this.thrown.push(error);
      throw error;
    }

    const prefix = `${uri}/`;
    const entries = new Map<string, FileType>();

    for (const file of this.files) {
      if (!file.startsWith(prefix)) continue;
      const [name, ...rest] = file.slice(prefix.length).split('/');
      entries.set(`${prefix}${name}`, rest.length > 0 ? FileType.Directory : FileType.File);
    }

    if (entries.size === 0) throw new Error(`Directory not found: ${uri}`);
    return [...entries];
  }

  async readFile(): Promise<string> {
    throw new Error('readFile should not be called');
  }

  async stat(): Promise<FileStat> {
    throw new Error('stat should not be called');
  }
}

const uri = (relativePath: string) => `${ROOT}/${relativePath}`;

const walk = (files: string[], filter?: (fileTuple: FileTuple) => boolean) =>
  walkAppSourceFiles(new TreeFileSystem(files.map(uri)), ROOT, filter);

describe('walkAppSourceFiles', () => {
  it('finds every file under the app subtrees, whatever the directories are called', async () => {
    const files = await walk([
      'app/views/pages/vendor/index.liquid',
      'app/lib/commands/v2/build/create.liquid',
      'app/graphql/tmp/query.graphql',
      'app/translations/en.yml',
      'marketplace_builder/views/partials/legacy.liquid',
      'modules/core/public/views/partials/card.liquid',
      'modules/core/private/lib/queries/get.liquid',
      'app/modules/core/public/views/partials/overwritten.liquid',
    ]);

    expect(files.sort()).toEqual(
      [
        'app/graphql/tmp/query.graphql',
        'app/lib/commands/v2/build/create.liquid',
        'app/modules/core/public/views/partials/overwritten.liquid',
        'app/translations/en.yml',
        'app/views/pages/vendor/index.liquid',
        'marketplace_builder/views/partials/legacy.liquid',
        'modules/core/private/lib/queries/get.liquid',
        'modules/core/public/views/partials/card.liquid',
      ].map(uri),
    );
  });

  it('never leaves the app subtrees, so nothing the platform does not deploy is walked', async () => {
    const fs = new TreeFileSystem(
      [
        'app/views/partials/card.liquid',
        'node_modules/some-pkg/app/views/partials/vendored.liquid',
        'tmp/app/views/partials/scratch.liquid',
        'dist/bundle.liquid',
        'vendor/legacy/page.liquid',
        'modules/core/react-app/node_modules/pkg/index.liquid',
        'modules/core/spec/views/partials/fixture.liquid',
        'scripts/deploy.liquid',
      ].map(uri),
    );

    const files = await walkAppSourceFiles(fs, ROOT);

    expect(files).toEqual([uri('app/views/partials/card.liquid')]);
    // Sorted: subtrees expand concurrently, so the order they interleave in is not
    // a promise the walk makes. WHICH directories it opens is.
    expect(fs.listed.sort()).toEqual([
      ROOT,
      uri('app'),
      uri('app/views'),
      uri('app/views/partials'),
      uri('modules'),
      uri('modules/core'),
    ]);
  });

  it('applies the caller filter to files only, and to files inside the subtrees only', async () => {
    const files = await walk(
      [
        'app/views/pages/index.liquid',
        'app/views/pages/style.css',
        'node_modules/pkg/app/views/pages/other.liquid',
      ],
      ([uri]) => uri.endsWith('.liquid'),
    );

    expect(files).toEqual([uri('app/views/pages/index.liquid')]);
  });

  it('lists every directory exactly once, however many subtrees share it', async () => {
    const fs = new TreeFileSystem(
      [
        'modules/core/public/views/partials/a.liquid',
        'modules/core/private/views/partials/b.liquid',
      ].map(uri),
    );

    await walkAppSourceFiles(fs, ROOT);

    expect(fs.listed.filter((dir) => dir === uri('modules/core'))).toEqual([uri('modules/core')]);
  });

  it('skips hidden files and hidden directories', async () => {
    const files = await walk([
      'app/views/partials/card.liquid',
      // An Emacs lock file (a dangling symlink), an AppleDouble copy, and an
      // editor's backup directory — none of them app sources.
      'app/views/partials/.#card.liquid',
      'app/views/partials/._card.liquid',
      'app/views/partials/.old/card.liquid',
      'modules/.git/public/views/partials/submodule.liquid',
    ]);

    expect(files).toEqual([uri('app/views/partials/card.liquid')]);
  });

  it('returns nothing for a project with no app subtrees at all', async () => {
    expect(await walk(['README.md', 'src/index.ts'])).toEqual([]);
  });

  it('surfaces a directory that exists and cannot be read, as an explained error', async () => {
    const fs = new TreeFileSystem(
      [uri('app/views/partials/card.liquid')],
      [uri('app/views/partials')],
    );

    const error = await walkAppSourceFiles(fs, ROOT).catch((e) => e);

    // The whole error, because every part of it is load-bearing: the TYPE is what
    // lets a UI caller print a sentence instead of a stack, the `uri` is what it
    // names, and the message is what the user actually reads.
    expect(error).toBeInstanceOf(UnreadableDirectoryError);
    expect({ name: error.name, uri: error.uri, message: error.message }).toEqual({
      name: 'UnreadableDirectoryError',
      uri: uri('app/views/partials'),
      // Named relative to the root — the absolute path stays available through the
      // cause, which is where the OS puts it.
      message:
        `Cannot read directory: app/views/partials\n` +
        `  EACCES: ${uri('app/views/partials')}\n\n` +
        `It is inside the app, so its contents would be deployed, and skipping it ` +
        `would mean reporting on only part of the project. ` +
        `Fix the directory's permissions, or move it out of the app, then run again.`,
    });
    expect(error.cause).toBe(fs.thrown[0]);
  });

  it('tolerates a directory deleted while the walk is in flight', async () => {
    const fs = new TreeFileSystem([uri('app/views/partials/card.liquid')]);
    const deleted = uri('app/views/partials');
    const readDirectory = fs.readDirectory.bind(fs);
    fs.readDirectory = async (dirUri: string) => {
      if (dirUri === deleted) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return readDirectory(dirUri);
    };

    expect(await walkAppSourceFiles(fs, ROOT)).toEqual([]);
  });
});
