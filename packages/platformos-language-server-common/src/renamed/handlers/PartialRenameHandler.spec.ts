import { MockApp, MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { assert, beforeEach, describe, expect, it } from 'vitest';
import { TextDocumentEdit } from 'vscode-json-languageservice';
import { ApplyWorkspaceEditParams } from 'vscode-languageserver-protocol';
import { ClientCapabilities } from '../../ClientCapabilities';
import { DocumentManager } from '../../documents';
import { MockConnection, mockConnection } from '../../test/MockConnection';
import { RenameHandler } from '../RenameHandler';

describe('Module: PartialRenameHandler', () => {
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
      'app/views/partials/page.liquid': `<div>{% render 'oldName', foo: 'bar' %}oldName</div>`,
      'app/lib/component.liquid': `<div>{% render 'oldName', foo: 'baz' %}</div>`,
      'app/views/partials/oldName.liquid': `<div>oldName{%</div>`,
      'app/views/partials/other.liquid': `<div>{% render 'oldName' %}{% render 'other' %}</div>`,
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
            oldUri: 'mock-fs:/app/views/partials/oldName.liquid',
            newUri: 'mock-fs:/app/views/partials/newName.liquid',
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

    it('returns a needConfirmation: false workspace edit for renaming a partial', async () => {
      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/views/partials/oldName.liquid',
            newUri: 'mock-fs:/app/views/partials/newName.liquid',
          },
        ],
      });

      const expectedTextEdit = {
        range: expect.any(Object),
        newText: 'newName',
      };

      expect(connection.spies.sendRequest).toHaveBeenCalledWith('workspace/applyEdit', {
        label: "Rename partial 'oldName' to 'newName'",
        edit: {
          changeAnnotations: {
            renamePartial: {
              label: `Rename partial 'oldName' to 'newName'`,
              needsConfirmation: false,
            },
          },
          documentChanges: [
            {
              textDocument: {
                uri: 'mock-fs:/app/views/partials/page.liquid',
                version: null,
              },
              edits: [expectedTextEdit],
              annotationId: 'renamePartial',
            },
            {
              textDocument: {
                uri: 'mock-fs:/app/views/partials/other.liquid',
                version: null,
              },
              edits: [expectedTextEdit],
              annotationId: 'renamePartial',
            },
            {
              textDocument: {
                uri: 'mock-fs:/app/lib/component.liquid',
                version: null,
              },
              edits: [expectedTextEdit],
              annotationId: 'renamePartial',
            },
          ],
        },
      });
    });

    it('replaces the correct text in the documents', async () => {
      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/views/partials/oldName.liquid',
            newUri: 'mock-fs:/app/views/partials/newName.liquid',
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      await expectAppliedEdits(params, 3, {
        'app/views/partials/page.liquid': `<div>{% render 'newName', foo: 'bar' %}oldName</div>`,
        'app/lib/component.liquid': `<div>{% render 'newName', foo: 'baz' %}</div>`,
        'app/views/partials/other.liquid': `<div>{% render 'newName' %}{% render 'other' %}</div>`,
      });
    });

    it('renames a NESTED partial by its full logical name, leaving a same-basename top-level partial alone', async () => {
      // `views/partials/ui/card.liquid` is `ui/card`, not `card` — computing `card`
      // from the basename missed every real call site and rewrote a different
      // partial's.
      withFiles({
        'app/views/partials/ui/tile.liquid': `<div>nested</div>`,
        'app/views/partials/card.liquid': `<div>top-level</div>`,
        'app/views/partials/page.liquid': `<div>{% render 'ui/card' %}{% render 'card' %}</div>`,
      });

      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/app/views/partials/ui/card.liquid',
            newUri: 'mock-fs:/app/views/partials/ui/tile.liquid',
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      expect(params.label).toBe("Rename partial 'ui/card' to 'ui/tile'");
      await expectAppliedEdits(params, 1, {
        'app/views/partials/page.liquid': `<div>{% render 'ui/tile' %}{% render 'card' %}</div>`,
      });
    });

    it('renames a MODULE partial by its module-prefixed name', async () => {
      withFiles({
        'modules/community/public/views/partials/tile.liquid': `<div>module partial</div>`,
        'app/views/partials/page.liquid': `<div>{% render 'modules/community/card' %}</div>`,
      });

      await handler.onDidRenameFiles({
        files: [
          {
            oldUri: 'mock-fs:/modules/community/public/views/partials/card.liquid',
            newUri: 'mock-fs:/modules/community/public/views/partials/tile.liquid',
          },
        ],
      });

      const params: ApplyWorkspaceEditParams = connection.spies.sendRequest.mock.calls[0][1];
      expect(params.label).toBe(
        "Rename partial 'modules/community/card' to 'modules/community/tile'",
      );
      await expectAppliedEdits(params, 1, {
        'app/views/partials/page.liquid': `<div>{% render 'modules/community/tile' %}</div>`,
      });
    });
  });
});
