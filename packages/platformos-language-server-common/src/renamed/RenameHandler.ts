import { Connection } from 'vscode-languageserver';
import { RenameFilesParams } from 'vscode-languageserver-protocol';
import { ClientCapabilities } from '../ClientCapabilities';
import { DocumentManager } from '../documents';
import { FindAppRootURI } from '../internal-types';
import { BaseRenameHandler } from './BaseRenameHandler';
import { AssetRenameHandler } from './handlers/AssetRenameHandler';
import { PartialRenameHandler } from './handlers/PartialRenameHandler';

/**
 * The RenameHandler is responsible for handling workspace/didRenameFiles notifications.
 *
 * Stuff we'll handle:
 * - When a partial is renamed, then we'll change all the render calls
 * - When an asset is renamed, then we'll change the asset_url calls
 */
export class RenameHandler {
  private handlers: BaseRenameHandler[];
  constructor(
    connection: Connection,
    capabilities: ClientCapabilities,
    documentManager: DocumentManager,
    findAppRootURI: FindAppRootURI,
  ) {
    this.handlers = [
      new PartialRenameHandler(documentManager, connection, capabilities, findAppRootURI),
      new AssetRenameHandler(documentManager, connection, capabilities, findAppRootURI),
    ];
  }

  async onDidRenameFiles(params: RenameFilesParams) {
    try {
      const promises = this.handlers.map((handler) => handler.onDidRenameFiles(params));
      await Promise.all(promises);
    } catch (error) {
      console.error(error);
      return;
    }
  }
}
