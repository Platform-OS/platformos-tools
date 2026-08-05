import { MockApp, MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { assert, beforeEach, describe, expect, it } from 'vitest';
import { TextDocumentEdit } from 'vscode-json-languageservice';
import { ApplyWorkspaceEditParams } from 'vscode-languageserver-protocol';
import { ClientCapabilities } from '../../ClientCapabilities';
import { DocumentManager } from '../../documents';
import { MockConnection, mockConnection } from '../../test/MockConnection';
import { RenameHandler } from '../RenameHandler';

describe('Module: AssetRenameHandler', () => {
  const mockRoot = 'mock-fs:';
  const findAppRootURI = async () => mockRoot;
  let capabilities: ClientCapabilities;
  let documentManager: DocumentManager;
  let handler: RenameHandler;
  let connection: MockConnection;
  let fs: MockFileSystem;

  /** Point the handler at a fresh project tree. */
  function withFiles(files: MockApp) {
    fs = new MockFileSystem(files, mockRoot);
    documentManager = new DocumentManager(fs);
    handler = new RenameHandler(connection, capabilities, documentManager, findAppRootURI);
  }

  /**
   * Assert the edit changes exactly `expectedChangeCount` documents, and that
   * applying each document's edits to `fs`'s copy produces `expected`'s copy.
   */
  async function expectAppliedEdits(
    params: ApplyWorkspaceEditParams,
    expectedChangeCount: number,
    expected: MockApp,
  ) {
    const expectedFs = new MockFileSystem(expected, mockRoot);
    assert(params.edit);
    assert(params.edit.documentChanges);
    expect(params.edit.documentChanges).toHaveLength(expectedChangeCount);
    for (const docChange of params.edit.documentChanges) {
      assert(TextDocumentEdit.is(docChange));
      const uri = docChange.textDocument.uri;
      expect(docChange.edits).to.applyEdits(await fs.readFile(uri), await expectedFs.readFile(uri));
    }
  }

  beforeEach(() => {
    connection = mockConnection(mockRoot);
    connection.spies.sendRequest.mockReturnValue(Promise.resolve(true));
    capabilities = new ClientCapabilities();
    withFiles({
      'app/assets/oldName.js': 'console.log("Hello, world!")',
      'app/views/partials/section.liquid': `<script src="{{ 'oldName.js' | asset_url }}" defer></script>`,
      'app/views/partials/block.liquid': `{{ 'oldName.js' | asset_url | script_tag }} oldName.js`,
    });
  });

  describe('when the client does not support workspace/applyEdit', () => {
    beforeEach(() => {
      capabilities.setup({
        workspace: {
          applyEdit: false,
        },
      });
    });

    it('does nothing', async () => {
      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/oldName.js',
            newUri: 'mock-fs:/app/assets/newName.js',
          },
        ],
      });
      expect(connection.spies.sendRequest).not.toHaveBeenCalled();
    });
  });

  describe('when the client supports workspace/applyEdit', () => {
    beforeEach(() => {
      capabilities.setup({
        workspace: {
          applyEdit: true,
        },
      });
    });

    it('returns a needConfirmation: false workspace edit for renaming an asset', async () => {
      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/oldName.js',
            newUri: 'mock-fs:/app/assets/newName.js',
          },
        ],
      });

      const expectedTextEdit = {
        range: expect.any(Object),
        newText: 'newName.js',
      };

      expect(connection.spies.sendRequest).toHaveBeenCalledWith('workspace/applyEdit', {
        label: "Rename asset 'oldName.js' to 'newName.js'",
        edit: {
          changeAnnotations: {
            renameAsset: {
              label: `Rename asset 'oldName.js' to 'newName.js'`,
              needsConfirmation: false,
            },
          },
          documentChanges: [
            {
              textDocument: {
                uri: 'mock-fs:/app/views/partials/section.liquid',
                version: null,
              },
              edits: [expectedTextEdit],
              annotationId: 'renameAsset',
            },
            {
              textDocument: {
                uri: 'mock-fs:/app/views/partials/block.liquid',
                version: null,
              },
              edits: [expectedTextEdit],
              annotationId: 'renameAsset',
            },
          ],
        },
      });
    });

    it('replaces the correct text in the documents', async () => {
      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/oldName.js',
            newUri: 'mock-fs:/app/assets/newName.js',
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      await expectAppliedEdits(params, 2, {
        'app/views/partials/section.liquid': `<script src="{{ 'newName.js' | asset_url }}" defer></script>`,
        'app/views/partials/block.liquid': `{{ 'newName.js' | asset_url | script_tag }} oldName.js`,
      });
    });

    it('keeps the FULL filename in the reference — a .css.liquid asset is referenced with its .liquid suffix', async () => {
      // The backend's AssetName strips only the directory prefix (`asset_parser.rb`),
      // so `assets/oldName.css.liquid` is the asset `oldName.css.liquid`. The
      // `.liquid`-stripping this handler used to do was Shopify's rule.
      withFiles({
        'app/assets/newName.css.liquid': 'body { color: red; }',
        'app/views/partials/section.liquid': `{% echo 'oldName.css.liquid' | asset_url | stylesheet_tag %}`,
      });

      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/oldName.css.liquid',
            newUri: `mock-fs:/app/assets/newName.css.liquid`,
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      expect(params.label).toBe("Rename asset 'oldName.css.liquid' to 'newName.css.liquid'");
      await expectAppliedEdits(params, 1, {
        'app/views/partials/section.liquid': `{% echo 'newName.css.liquid' | asset_url | stylesheet_tag %}`,
      });
    });

    it('does not rewrite a reference to the .liquid-stripped spelling — that names a DIFFERENT asset', async () => {
      withFiles({
        'app/assets/newName.css.liquid': 'body { color: red; }',
        'app/views/partials/section.liquid': `{% echo 'oldName.css' | asset_url | stylesheet_tag %}`,
      });

      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/oldName.css.liquid',
            newUri: `mock-fs:/app/assets/newName.css.liquid`,
          },
        ],
      });

      expect(connection.spies.sendRequest).not.toHaveBeenCalled();
    });

    it('renames a NESTED asset by its directory-qualified name, leaving a same-basename top-level asset alone', async () => {
      // `assets/js/app.js` is the asset `js/app.js` — computing `app.js` from the
      // basename missed every real reference and rewrote a different asset's.
      withFiles({
        'app/assets/js/newName.js': 'console.log("nested")',
        'app/assets/oldName.js': 'console.log("top-level")',
        'app/views/partials/section.liquid': `{{ 'js/oldName.js' | asset_url }}{{ 'oldName.js' | asset_url }}`,
      });

      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/assets/js/oldName.js',
            newUri: 'mock-fs:/app/assets/js/newName.js',
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      expect(params.label).toBe("Rename asset 'js/oldName.js' to 'js/newName.js'");
      await expectAppliedEdits(params, 1, {
        'app/views/partials/section.liquid': `{{ 'js/newName.js' | asset_url }}{{ 'oldName.js' | asset_url }}`,
      });
    });
  });
});
