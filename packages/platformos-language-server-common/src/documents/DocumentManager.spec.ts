import { path } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
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
    const fileUri = Utils.joinPath(rootUri, 'test.liquid');

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

  describe('when initialized with an abstract file system', () => {
    beforeEach(async () => {
      fs = new MockFileSystem(
        {
          'snippet/foo.liquid': `hello {% render 'bar' %}`,
          'snippet/bar.liquid': `world`,
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
        const sc = documentManager.get('mock-fs:/snippet/foo.liquid');
        assert(sc);
        expect(sc.version).to.equal(undefined);
      });

      it('returns defined versions of opened files', () => {
        documentManager.open('mock-fs:/snippet/foo.liquid', 'hello {% render "bar" %}', 0);
        const sc = documentManager.get('mock-fs:/snippet/foo.liquid');
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
          documentManager.open('mock-fs:/snippet/foo.liquid', 'hello {% render "bar" %}', 10);
          documentManager.close('mock-fs:/snippet/foo.liquid');
          const sc = documentManager.get('mock-fs:/snippet/foo.liquid');
          assert(sc);
          expect(sc.source).to.equal('hello {% render "bar" %}');
          expect(sc.version).to.equal(undefined);
        });
      });

      describe('Unit: delete(uri)', () => {
        it('deletes the source code from the document manager', () => {
          // as though the file no longer exists
          documentManager.open('mock-fs:/snippet/foo.liquid', 'hello {% render "bar" %}', 10);
          documentManager.delete('mock-fs:/snippet/foo.liquid');
          const sc = documentManager.get('mock-fs:/snippet/foo.liquid');
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
          'snippet/1.liquid': `hello {% render 'bar' %}`,
          'snippet/2.liquid': `hello {% render 'bar' %}`,
          'snippet/3.liquid': `hello {% render 'bar' %}`,
          'snippet/4.liquid': `hello {% render 'bar' %}`,
          'snippet/5.liquid': `hello {% render 'bar' %}`,
          'snippet/6.liquid': `hello {% render 'bar' %}`,
          'snippet/7.liquid': `hello {% render 'bar' %}`,
          'snippet/8.liquid': `hello {% render 'bar' %}`,
          'snippet/9.liquid': `hello {% render 'bar' %}`,
          'snippet/10.liquid': `hello {% render 'bar' %}`,
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
  });
});
