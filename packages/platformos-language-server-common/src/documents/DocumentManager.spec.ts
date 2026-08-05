import { path } from '@platformos/platformos-check-common';
import { AbstractFileSystem, UnreadableDirectoryError } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI, Utils } from 'vscode-uri';
import { DocumentManager } from './DocumentManager';
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
