import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
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
  beforeEach(() => {
    connection = mockConnection(mockRoot);
    connection.spies.sendRequest.mockReturnValue(Promise.resolve(true));
    capabilities = new ClientCapabilities();
    fs = new MockFileSystem(
      {
        'app/views/partials/page.liquid': `<div>{% render 'oldName', foo: 'bar' %}oldName</div>`,
        'app/lib/component.liquid': `<div>{% render 'oldName', foo: 'baz' %}</div>`,
        'app/views/partials/oldName.liquid': `<div>oldName{%</div>`,
        'app/views/partials/other.liquid': `<div>{% render 'oldName' %}{% render 'other' %}</div>`,
      },
      mockRoot,
    );
    documentManager = new DocumentManager(fs);
    handler = new RenameHandler(connection, capabilities, documentManager, findAppRootURI);
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
      const expectedFs = new MockFileSystem(
        {
          'app/views/partials/page.liquid': `<div>{% render 'newName', foo: 'bar' %}oldName</div>`,
          'app/lib/component.liquid': `<div>{% render 'newName', foo: 'baz' %}</div>`,
          'app/views/partials/newName.liquid': `<div>oldName{%</div>`,
          'app/views/partials/other.liquid': `<div>{% render 'newName' %}{% render 'other' %}</div>`,
        },
        'mock-fs:',
      );

      assert(params.edit);
      assert(params.edit.documentChanges);
      for (const docChange of params.edit.documentChanges) {
        assert(TextDocumentEdit.is(docChange));
        const uri = docChange.textDocument.uri;
        const edits = docChange.edits;
        const initialDoc = await fs.readFile(uri);
        const expectedDoc = await expectedFs.readFile(uri);
        expect(edits).to.applyEdits(initialDoc, expectedDoc);
      }
    });
  });
});
