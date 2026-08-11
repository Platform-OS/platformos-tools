import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { path, SourceCodeType } from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import {
  AbstractFileSystem,
  App,
  Parsers,
  PlatformOSFileType,
  relativePosixPath,
  UnreadableDirectoryError,
} from '@platformos/platformos-common';
import { appBackedGetSourceCode } from '@platformos/platformos-graph';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI, Utils } from 'vscode-uri';
import { DocumentManager, languageServerParsers } from './DocumentManager';
import { AugmentedSourceCode } from './types';
import { mockConnection } from '../test/MockConnection';
import { ClientCapabilities } from '../ClientCapabilities';

describe('Module: DocumentManager', () => {
  const mockRoot = 'mock-fs:';
  let documentManager: DocumentManager;
  let connection: ReturnType<typeof mockConnection>;
  let fs: AbstractFileSystem;

  beforeEach(() => {
    documentManager = new DocumentManager();
  });

  it('should return an app for a root', () => {
    // these will be different in windows vs unix
    const rootUri = URI.file(__dirname);
    const fileUri = Utils.joinPath(rootUri, 'app', 'views', 'partials', 'test.liquid');

    // We expect forward slash paths (windows path get normalized)
    expect(fileUri.path).not.to.include('\\');
    documentManager.open(fileUri.toString(), '{{ "hi" }}', 0);
    const app = documentManager.app(path.normalize(rootUri));
    expect(app).to.have.lengthOf(1);
    expect(app[0].uri).not.to.include('\\');
    // `fileURI.toString()` lowercases c: in 'C:\dir\path'
    // Without the URI.parse().path, this test was failing for a dumb reason
    expect(app[0].uri).to.equal(path.normalize(fileUri));
  });

  /**
   * `preload` walks the app subtrees, so a directory's NAME never decides whether
   * the language server manages the files under it. The walk this replaced skipped
   * any directory ending in `vendor`, `build`, `tmp` or `dist`, so an entire site
   * section under `app/views/pages/vendor/**` was unmanaged — no diagnostics, no
   * completions, no rename — with nothing to indicate why.
   */
  describe('preload on a project with app directories named like build output', () => {
    it('manages the files under them, and none outside the app subtrees', async () => {
      const projectRoot = 'mock-fs:';
      const projectFs = new MockFileSystem(
        {
          'app/views/pages/vendor/index.liquid': `a vendor page`,
          'app/lib/commands/build/create.liquid': `a command`,
          'modules/core/public/views/partials/tmp/card.liquid': `a module partial`,
          'tmp/app/views/partials/scratch.liquid': `not deployed`,
          'node_modules/some-pkg/app/views/partials/vendored.liquid': `not ours`,
          'dist/app/views/pages/bundled.liquid': `build output`,
        },
        projectRoot,
      );
      const manager = new DocumentManager(projectFs);

      await manager.preload('mock-fs:/');

      expect(
        manager
          .app('mock-fs:/', true)
          .map((sourceCode) => sourceCode.uri)
          .sort(),
      ).toEqual([
        'mock-fs:/app/lib/commands/build/create.liquid',
        'mock-fs:/app/views/pages/vendor/index.liquid',
        'mock-fs:/modules/core/public/views/partials/tmp/card.liquid',
      ]);
    });
  });

  describe('when initialized with an abstract file system', () => {
    beforeEach(async () => {
      fs = new MockFileSystem(
        {
          'app/views/partials/foo.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/bar.liquid': `world`,
        },
        'mock-fs:',
      );
      documentManager = new DocumentManager(fs);
      vi.spyOn(fs, 'readFile');
    });

    describe('when the abstract file system is preloaded', () => {
      beforeEach(async () => {
        await documentManager.preload('mock-fs:/');
      });

      it('preloads source codes with a version of undefined', async () => {
        const sc = documentManager.get('mock-fs:/app/views/partials/foo.liquid');
        assert(sc);
        expect(sc.version).to.equal(undefined);
      });

      it('returns defined versions of opened files', () => {
        documentManager.open(
          'mock-fs:/app/views/partials/foo.liquid',
          'hello {% render "bar" %}',
          0,
        );
        const sc = documentManager.get('mock-fs:/app/views/partials/foo.liquid');
        assert(sc);
        expect(sc.version).to.equal(0);
      });

      describe('Unit: app(rootUri, includeFilesFromDisk)', () => {
        it('only returns the source codes of the opened files by default', () => {
          const app = documentManager.app('mock-fs:/');
          expect(app).to.have.lengthOf(0);
        });

        it('returns all the files when called with includeFilesFromDisk', async () => {
          const app = documentManager.app('mock-fs:/', true);
          expect(app).to.have.lengthOf(2);
        });
      });

      describe('Unit: close(uri)', () => {
        it('sets the source version to undefined (value is on disk)', () => {
          documentManager.open(
            'mock-fs:/app/views/partials/foo.liquid',
            'hello {% render "bar" %}',
            10,
          );
          documentManager.close('mock-fs:/app/views/partials/foo.liquid');
          const sc = documentManager.get('mock-fs:/app/views/partials/foo.liquid');
          assert(sc);
          expect(sc.source).to.equal('hello {% render "bar" %}');
          expect(sc.version).to.equal(undefined);
        });
      });

      describe('Unit: delete(uri)', () => {
        it('deletes the source code from the document manager', () => {
          // as though the file no longer exists
          documentManager.open(
            'mock-fs:/app/views/partials/foo.liquid',
            'hello {% render "bar" %}',
            10,
          );
          documentManager.delete('mock-fs:/app/views/partials/foo.liquid');
          const sc = documentManager.get('mock-fs:/app/views/partials/foo.liquid');
          assert(!sc);
        });
      });

      describe('Unit: preload(rootUri)', () => {
        it('should be memoized and only run once', async () => {
          await documentManager.preload('mock-fs:/');
          await documentManager.preload('mock-fs:/');
          await documentManager.preload('mock-fs:/');
          await documentManager.preload('mock-fs:/');
          expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(
            documentManager.app('mock-fs:/', true).length,
          );
        });
      });
    });
  });

  describe('when initialized with a connection & hasProgressSupport', () => {
    beforeEach(() => {
      const capabilities = new ClientCapabilities();
      capabilities.setup({
        window: {
          workDoneProgress: true,
        },
      });
      connection = mockConnection(mockRoot);
      connection.spies.onRequest.mockImplementationOnce(async (method) => {
        switch (method) {
          case 'window/workDoneProgress/create':
            return 'ok';
          default:
            throw new Error(`Unexpected method: ${method}`);
        }
      });

      fs = new MockFileSystem(
        {
          'app/views/partials/1.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/2.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/3.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/4.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/5.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/6.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/7.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/8.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/9.liquid': `hello {% render 'bar' %}`,
          'app/views/partials/10.liquid': `hello {% render 'bar' %}`,
        },
        mockRoot,
      );
      vi.spyOn(fs, 'readFile');

      documentManager = new DocumentManager(fs, connection, capabilities);
    });

    it('should report progress while preloading', async () => {
      await documentManager.preload(mockRoot);
      expect(connection.spies.sendProgress).toHaveBeenCalledTimes(4);
      expect(connection.spies.sendProgress).toHaveBeenCalledWith(
        expect.anything(),
        'preload#mock-fs:',
        {
          kind: 'begin',
          title: 'Initializing Liquid LSP',
        },
      );
      expect(connection.spies.sendProgress).toHaveBeenCalledWith(
        expect.anything(),
        'preload#mock-fs:',
        {
          kind: 'report',
          message: 'Preloading files',
          percentage: 10,
        },
      );
      expect(connection.spies.sendProgress).toHaveBeenCalledWith(
        expect.anything(),
        'preload#mock-fs:',
        {
          kind: 'report',
          message: 'Preloading files [10/10]',
          percentage: 100,
        },
      );
      expect(connection.spies.sendProgress).toHaveBeenCalledWith(
        expect.anything(),
        'preload#mock-fs:',
        {
          kind: 'end',
          message: 'Completed',
        },
      );
    });

    /**
     * A preload that fails is not specific to an unreadable directory — a dropped
     * network mount, EMFILE on a large project, a directory Windows has locked all
     * reach here. What made any of them fatal for the session was that `preload` is
     * `memoize`d: the REJECTED promise stayed in the cache, so every later preload
     * of that root replayed the failure even after its cause was gone. And the
     * progress token was never ended, leaving 'Initializing Liquid LSP' on screen
     * for the rest of the session.
     */
    describe('when the walk fails', () => {
      const unreadable = 'mock-fs:/app/views/partials';
      let readDirectory: typeof fs.readDirectory;

      beforeEach(() => {
        readDirectory = fs.readDirectory.bind(fs);
        vi.spyOn(fs, 'readDirectory').mockImplementation(async (uri) => {
          if (uri === unreadable) throw new Error('EACCES: permission denied');
          return readDirectory(uri);
        });
      });

      it('ends the progress, tells the user which directory, and recovers once it is readable', async () => {
        await expect(documentManager.preload(mockRoot)).rejects.toBeInstanceOf(
          UnreadableDirectoryError,
        );

        // The spinner stops, rather than claiming to still be initializing.
        expect(connection.spies.sendProgress).toHaveBeenCalledWith(
          expect.anything(),
          'preload#mock-fs:',
          { kind: 'end', message: 'Failed' },
        );

        // And the user is told what to do about it, once.
        const message =
          'Cannot read directory: app/views/partials\n' +
          '  EACCES: permission denied\n\n' +
          'It is inside the app, so its contents would be deployed, and skipping it ' +
          'would mean reporting on only part of the project. ' +
          "Fix the directory's permissions, or move it out of the app, then run again.";
        const shown = () =>
          connection.spies.sendRequest.mock.calls.filter(
            ([method]: any[]) => method === 'window/showMessageRequest',
          );
        // `type: 1` is MessageType.Error — a toast, not a line in the output channel.
        expect(shown().map(([, params]: any[]) => params)).toEqual([
          { type: 1, message, actions: [] },
        ]);

        // A repeat of the SAME failure is not a second toast — the graph rebuild
        // preloads again on every file event, so this would be one per save.
        await expect(documentManager.preload(mockRoot)).rejects.toBeInstanceOf(
          UnreadableDirectoryError,
        );
        expect(shown()).toHaveLength(1);

        // The memo did not keep the rejection, so fixing the cause is enough.
        vi.mocked(fs.readDirectory).mockImplementation(readDirectory);
        await documentManager.preload(mockRoot);

        expect(
          documentManager
            .app(mockRoot, true)
            .map((sourceCode) => sourceCode.uri)
            .sort(),
        ).toEqual([
          'mock-fs:/app/views/partials/1.liquid',
          'mock-fs:/app/views/partials/10.liquid',
          'mock-fs:/app/views/partials/2.liquid',
          'mock-fs:/app/views/partials/3.liquid',
          'mock-fs:/app/views/partials/4.liquid',
          'mock-fs:/app/views/partials/5.liquid',
          'mock-fs:/app/views/partials/6.liquid',
          'mock-fs:/app/views/partials/7.liquid',
          'mock-fs:/app/views/partials/8.liquid',
          'mock-fs:/app/views/partials/9.liquid',
        ]);
      });
    });
  });
});

/**
 * `DocumentManager` is the language server's view of the SAME `App` the linter and
 * the graph build hold — not a second, LSP-shaped store of source codes beside it.
 *
 * What these pin:
 *
 * - opening a workspace parses nothing (the parse is `AppFile`'s, on first `ast`), so a
 *   file nobody looks at costs a read and nothing else;
 * - `set` asks "is this part of an app" WITH a root, the way every other consumer does;
 * - the graph and the checks read the same file objects, so each file is parsed once for
 *   both rather than once each.
 */
describe('Module: DocumentManager as an App adapter', () => {
  const root = 'mock-fs:';
  const foo = 'mock-fs:/app/views/partials/foo.liquid';
  const bar = 'mock-fs:/app/views/partials/bar.liquid';
  const query = 'mock-fs:/app/graphql/find_user.graphql';

  let files: Record<string, string>;
  let fs: MockFileSystem;
  let manager: DocumentManager;
  let parseLiquid: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    files = {
      'app/views/partials/foo.liquid': `hello {% render 'bar' %}`,
      'app/views/partials/bar.liquid': `world`,
      'app/graphql/find_user.graphql': `query find_user { users { id } }`,
      'app/assets/app.js': `export const x = 1;`,
      // Under the root, readable by our parsers, and NOT deployed: `scripts/` is
      // not an app subtree, and `seed/` merely CONTAINS a path that looks like one.
      'scripts/build.liquid': `not deployed`,
      'seed/post_import/app/views/partials/scratch.liquid': `also not deployed`,
    };
    fs = new MockFileSystem(files, root);
    manager = new DocumentManager(fs);
    parseLiquid = vi.spyOn(languageServerParsers as any, SourceCodeType.LiquidHtml);
  });

  // `languageServerParsers` is a module-level singleton — the spy has to come back
  // off it, or the next test counts this one's parses too.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('preload', () => {
    it('reads the app source files and parses none of them', async () => {
      await manager.preload(root);

      expect(parseLiquid).not.toHaveBeenCalled();
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });

    it('parses a file once, on the first read of its ast', async () => {
      await manager.preload(root);

      const document = manager.get(foo)!;
      expect(document.ast).toBe(document.ast);
      expect(parseLiquid.mock.calls).toEqual([[`hello {% render 'bar' %}`, foo]]);
    });

    it('leaves a parse error as a captured Error rather than throwing', async () => {
      files['app/views/partials/foo.liquid'] = `{% if %}`;

      await manager.preload(root);

      expect(manager.get(foo)!.ast).toBeInstanceOf(Error);
    });
  });

  /**
   * `version === undefined` means "this is what is on disk"; a number means "this
   * is an editor buffer". Several features read nothing else to tell them apart.
   */
  describe('app(root, includeFilesFromDisk)', () => {
    beforeEach(async () => {
      await manager.preload(root);
    });

    it('returns only the open buffers by default', () => {
      expect(manager.app(root)).toEqual([]);

      manager.open(foo, 'edited', 7);

      expect(manager.app(root).map((file) => [file.uri, file.version])).toEqual([[foo, 7]]);
    });

    it('returns every app source file with includeFilesFromDisk, open or not', () => {
      manager.open(foo, 'edited', 7);

      expect(manager.app(root, true).map((file) => [file.uri, file.version])).toEqual([
        [foo, 7],
        [bar, undefined],
        [query, undefined],
      ]);
    });

    it('never returns a file the platform does not deploy, or one it cannot parse', () => {
      // `app/assets/app.js` is in the app and is a graph node; it has no
      // SourceCodeType, so no check can be written against it.
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });
  });

  describe('the operations, against the App they leave behind', () => {
    beforeEach(async () => {
      await manager.preload(root);
    });

    it('open and change record the buffer and its version', () => {
      manager.open(foo, 'opened', 1);
      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['opened', 1]);

      manager.change(foo, 'changed', 2);
      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['changed', 2]);
    });

    it('changeFromDisk replaces the contents and drops the version', async () => {
      manager.open(foo, 'opened', 1);
      files['app/views/partials/foo.liquid'] = 'from disk';

      await manager.changeFromDisk(foo);

      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual([
        'from disk',
        undefined,
      ]);
    });

    it('close keeps the contents and drops the version', () => {
      manager.open(foo, 'opened', 1);

      manager.close(foo);

      expect([manager.get(foo)!.source, manager.get(foo)!.version]).toEqual(['opened', undefined]);
    });

    it('delete removes the file from the app', () => {
      expect(manager.delete(foo)).toBe(true);

      expect(manager.get(foo)).toBe(undefined);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([bar, query]);
    });

    /**
     * The app holds the file the moment its PATH is classified, which is before the
     * read that gives it contents. `AppFile.source` throws rather than pretending to
     * be `''`, so a document exists here exactly when its contents do — the same set
     * the `Map<uri, SourceCode>` this replaced held, since it only got an entry once
     * the read returned.
     *
     * Getting this wrong is silent and expensive: `runChecks` resolves a partial's
     * `{% doc %}` through `get()`, so a file that answered before it was read would
     * cost every cross-file diagnostic that depends on it.
     */
    it('does not hand out a file whose contents have not been read', () => {
      const unread = 'mock-fs:/app/views/partials/added.liquid';
      manager.appModel(root).update([unread]);

      expect(manager.appModel(root).has(unread)).toBe(true);
      expect(manager.get(unread)).toBe(undefined);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
    });

    it('rename moves the contents and the version to the new uri', () => {
      const renamed = 'mock-fs:/app/views/partials/renamed.liquid';
      manager.open(foo, 'opened', 3);

      manager.rename(foo, renamed);

      expect(manager.get(foo)).toBe(undefined);
      expect([manager.get(renamed)!.source, manager.get(renamed)!.version]).toEqual(['opened', 3]);
      expect(manager.app(root, true).map((file) => file.uri)).toEqual([bar, query, renamed]);
    });

    /**
     * Even with no contents to carry over. The old path is gone from disk, and an
     * app that still lists it hands the graph a file to read that is not there.
     */
    it('rename drops the old path from the app when its contents were never read', () => {
      const unread = 'mock-fs:/app/views/partials/added.liquid';
      manager.appModel(root).update([unread]);

      manager.rename(unread, 'mock-fs:/app/views/partials/moved.liquid');

      expect(manager.appModel(root).has(unread)).toBe(false);
    });

    /**
     * Removing an `app/modules/X` overwrite promotes the `modules/X` original back
     * — the App's own rule, and the reason `delete` goes through it rather than
     * dropping a map entry.
     */
    it('delete of a module overwrite leaves the original resolving', async () => {
      files['modules/core/public/views/partials/card.liquid'] = 'the original';
      files['app/modules/core/public/views/partials/card.liquid'] = 'the overwrite';
      manager = new DocumentManager(new MockFileSystem(files, root));
      await manager.preload(root);
      const overwrite = 'mock-fs:/app/modules/core/public/views/partials/card.liquid';
      const original = 'mock-fs:/modules/core/public/views/partials/card.liquid';

      expect(
        manager.appModel(root).find(PlatformOSFileType.Partial, 'modules/core/card')!.uri,
      ).toBe(overwrite);

      manager.delete(overwrite);

      expect(
        manager.appModel(root).find(PlatformOSFileType.Partial, 'modules/core/card')!.uri,
      ).toBe(original);
    });
  });

  /**
   * The question `set` could not ask before this class held an `App`.
   *
   * A platformOS file is one whose position RELATIVE TO THE PROJECT ROOT matches the
   * directory structure — that is what `getFileType`, `AppGraph` and every check ask.
   * `set` had no root, so it asked `sourceCodeTypeOf` instead ("can we parse it"),
   * and the app-membership question was deferred to `app(root)`. Now the app the URI
   * falls under supplies the root and both are answered in one place.
   */
  describe('classification with a root', () => {
    const script = 'mock-fs:/scripts/build.liquid';
    const seed = 'mock-fs:/seed/post_import/app/views/partials/scratch.liquid';

    beforeEach(async () => {
      await manager.preload(root);
    });

    it('keeps a readable file the platform does not deploy out of the app', () => {
      manager.open(script, 'not deployed', 1);
      manager.open(seed, 'also not deployed', 1);

      expect(manager.app(root, true).map((file) => file.uri)).toEqual([foo, bar, query]);
      expect([manager.appModel(root).has(script), manager.appModel(root).has(seed)]).toEqual([
        false,
        false,
      ]);
    });

    /**
     * It is still a document. The editor formats, highlights and completes in a
     * `.liquid` file wherever it is; what it does not get is diagnostics, or a node
     * in the app graph, because it is not part of the app.
     */
    it('still manages it as an editor document', () => {
      manager.open(script, '{{ "hi" }}', 1);

      const document = manager.get(script)!;
      expect([document.uri, document.type, document.source, document.version]).toEqual([
        script,
        SourceCodeType.LiquidHtml,
        '{{ "hi" }}',
        1,
      ]);
      expect(document.textDocument.getText()).toBe('{{ "hi" }}');
      expect(manager.openDocuments.map((file) => file.uri)).toEqual([script]);
    });

    it('does not manage a buffer it has no parser for', () => {
      manager.open('mock-fs:/app/assets/theme.css.liquid', 'a { color: red }', 1);

      expect(manager.get('mock-fs:/app/assets/theme.css.liquid')).toBe(undefined);
    });
  });

  /**
   * `didOpen` arrives before anything has asked which project the file belongs to,
   * so the buffer lands before there is a root to classify it against. It must not
   * be lost, and it must not stay outside the app once the root IS named.
   */
  describe('a buffer opened before its root is known', () => {
    it('joins the app the moment a root is named', () => {
      manager.open(foo, 'opened first', 4);

      expect(manager.get(foo)!.source).toBe('opened first');

      expect(manager.app(root, true).map((file) => [file.uri, file.source, file.version])).toEqual([
        [foo, 'opened first', 4],
      ]);
      expect(manager.appModel(root).has(foo)).toBe(true);
    });
  });

  /**
   * The double parse this epic set out to remove, at its last site: a process that
   * builds a graph AND runs checks over one project.
   */
  describe('sharing one parse with the graph', () => {
    it('serves the graph the very file objects the checks parse, unmarked by the LSP', async () => {
      await manager.preload(root);
      const app = manager.appModel(root);
      const getSourceCode = appBackedGetSourceCode(app, async () => {
        throw new Error('the app should have contained it');
      });

      const forTheGraph = await getSourceCode(foo);
      const editorView = manager.get(foo)!;

      // The graph gets the AppFile ITSELF. The language server's view is held
      // BESIDE the file (a WeakMap in DocumentManager), never written onto it, so
      // the object another package holds carries no LSP property.
      expect(forTheGraph).toBe(app.get(foo));
      expect('textDocument' in (forTheGraph as unknown as object)).toBe(false);
      expect('getLiquidDoc' in (forTheGraph as unknown as object)).toBe(false);

      // And one parse still serves both: the view's `ast` delegates to the file's.
      expect(editorView.ast).toBe(forTheGraph.ast);
      expect(parseLiquid.mock.calls).toEqual([[`hello {% render 'bar' %}`, foo]]);
    });

    it('parses the assets only the graph reads, with the graph parser', async () => {
      await manager.preload(root);
      const getSourceCode = appBackedGetSourceCode(manager.appModel(root), async () => {
        throw new Error('the app should have contained it');
      });

      const asset = await getSourceCode('mock-fs:/app/assets/app.js');

      expect((asset.ast as { type: string }).type).toBe('Program');
      // A `.js` asset is a graph node and never an editor document.
      expect(manager.get('mock-fs:/app/assets/app.js')).toBe(undefined);
    });
  });
  /**
   * Every spelling of a root — trailing slash or not, bare `scheme:` or `scheme:/` —
   * must key ONE app, or which app a file lands in depends on how the caller spelled it.
   */
  describe('the root spelling', () => {
    it('is one app whether or not the root has a trailing slash', async () => {
      await manager.preload('mock-fs:/');
      manager.open(foo, 'edited', 1);

      expect(manager.appModel('mock-fs:/')).toBe(manager.appModel('mock-fs:'));
      expect(manager.app('mock-fs:').map((file) => file.uri)).toEqual([foo]);
      expect(manager.app('mock-fs:/').map((file) => file.uri)).toEqual([foo]);
    });
  });
});

/**
 * `fileType` is THE language server's classifier: one place that turns a bare URI
 * into a `PlatformOSFileType`, with one meaning of "no root" — `undefined`. Under
 * a known root it must not walk at all: the `AppFile` classified its path once.
 */
describe('DocumentManager.fileType', () => {
  const root = 'mock-fs:';
  const fs = () =>
    new MockFileSystem(
      {
        'app/views/pages/home.liquid': '<h1>home</h1>',
        'app/views/partials/foo.liquid': 'foo',
      },
      root,
    );

  it('answers for a URI under a known root without consulting the root finder', async () => {
    const finder = vi.fn(async () => {
      throw new Error('the finder must not be walked for a URI under a known root');
    });
    const manager = new DocumentManager(fs(), undefined, undefined, undefined, finder);
    await manager.preload(root);

    expect(await manager.fileType('mock-fs:/app/views/pages/home.liquid')).toBe(
      PlatformOSFileType.Page,
    );
    expect(await manager.fileType('mock-fs:/app/views/partials/foo.liquid')).toBe(
      PlatformOSFileType.Partial,
    );
    // Under the root and NOT in the app: classified against the known root, still
    // with no walk.
    expect(await manager.fileType('mock-fs:/scripts/build.liquid')).toBe(undefined);
    expect(finder).not.toHaveBeenCalled();
  });

  it('walks for the root only when none is known, and undefined means no root', async () => {
    const finder = vi.fn(async (uri: string) =>
      uri.startsWith('found-fs:/project/') ? 'found-fs:/project' : null,
    );
    const manager = new DocumentManager(undefined, undefined, undefined, undefined, finder);

    expect(await manager.fileType('found-fs:/project/app/views/pages/home.liquid')).toBe(
      PlatformOSFileType.Page,
    );
    expect(await manager.fileType('elsewhere-fs:/loose/file.liquid')).toBe(undefined);
    expect(finder.mock.calls).toEqual([
      ['found-fs:/project/app/views/pages/home.liquid'],
      ['elsewhere-fs:/loose/file.liquid'],
    ]);
  });

  it('answers undefined when it has no way to find a root', async () => {
    const manager = new DocumentManager();
    expect(await manager.fileType('file:///somewhere/app/views/pages/home.liquid')).toBe(undefined);
  });
});

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
        offenders.push(`${relativePosixPath(file, packageRoot)}: ${match}`);
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
