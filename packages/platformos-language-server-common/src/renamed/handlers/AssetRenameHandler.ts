import { LiquidVariable, NodeTypes } from '@platformos/liquid-html-parser';
import { path, SourceCodeType, visit } from '@platformos/platformos-check-common';
import { Connection } from 'vscode-languageserver';
import {
  ApplyWorkspaceEditRequest,
  Range,
  RenameFilesParams,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol';
import { ClientCapabilities } from '../../ClientCapabilities';
import { DocumentManager, isLiquidSourceCode } from '../../documents';
import { assetName, isAsset } from '../../utils/uri';
import { BaseRenameHandler } from '../BaseRenameHandler';
import { FindAppRootURI } from '../../internal-types';

/**
 * The AssetRenameHandler will handle asset renames.
 *
 * We'll change all the `| asset_url` that reference the old asset:
 *   {{ 'oldName.js' | asset_url }} -> {{ 'newName.js' | asset_url }}
 *
 * Asset names keep their FULL filename, `.liquid` included — a `theme.css.liquid`
 * asset is referenced as `'theme.css.liquid' | asset_url` (see `assetName`).
 *
 * We'll do this by visiting all the liquid files in the app and looking for
 * string | asset_url Variable nodes that reference the old asset. We'll then create a
 * WorkspaceEdit that changes the references to the new asset.
 */
export class AssetRenameHandler implements BaseRenameHandler {
  constructor(
    private documentManager: DocumentManager,
    private connection: Connection,
    private capabilities: ClientCapabilities,
    private findAppRootURI: FindAppRootURI,
  ) {}

  async onDidRenameFiles(params: RenameFilesParams): Promise<void> {
    if (!this.capabilities.hasApplyEditSupport) return;
    if (params.files.length === 0) return;

    // The root comes first: whether a path is an asset is its position relative to it.
    const rootUri = await this.findAppRootURI(path.dirname(params.files[0].oldUri));
    if (!rootUri) return;

    const relevantRenames = params.files.filter(
      (file) => isAsset(file.oldUri, rootUri) && isAsset(file.newUri, rootUri),
    );

    // Only preload if you have something to do (folder renames are not supported)
    if (relevantRenames.length !== 1) return;
    const rename = relevantRenames[0];
    const oldAssetName = assetName(rename.oldUri, rootUri);
    const newAssetName = assetName(rename.newUri, rootUri);
    if (!oldAssetName || !newAssetName) return;
    await this.documentManager.preload(rootUri);
    const app = this.documentManager.app(rootUri, true);
    const liquidSourceCodes = app.filter(isLiquidSourceCode);
    const editLabel = `Rename asset '${oldAssetName}' to '${newAssetName}'`;
    const annotationId = 'renameAsset';
    const workspaceEdit: WorkspaceEdit = {
      documentChanges: [],
      changeAnnotations: {
        [annotationId]: {
          label: editLabel,
          needsConfirmation: false,
        },
      },
    };

    for (const sourceCode of liquidSourceCodes) {
      if (sourceCode.ast instanceof Error) continue;
      const textDocument = sourceCode.textDocument;
      const edits: TextEdit[] = await visit<SourceCodeType.LiquidHtml, TextEdit>(sourceCode.ast, {
        async LiquidVariable(node: LiquidVariable) {
          if (node.filters.length === 0) return;
          if (node.expression.type !== NodeTypes.String) return;
          if (node.filters[0].name !== 'asset_url') return;
          const assetName = node.expression.value;
          if (assetName !== oldAssetName) return;
          return {
            newText: newAssetName,
            range: Range.create(
              textDocument.positionAt(node.expression.position.start + 1), // +1 to skip the opening quote
              textDocument.positionAt(node.expression.position.end - 1), // -1 to skip the closing quote
            ),
          };
        },
      });

      if (edits.length === 0) continue;
      workspaceEdit.documentChanges!.push({
        textDocument: {
          uri: textDocument.uri,
          version: sourceCode.version ?? null /* null means file from disk in this API */,
        },
        annotationId,
        edits,
      });
    }

    if (workspaceEdit.documentChanges!.length === 0) {
      console.error('Nothing to do!');
      return;
    }

    await this.connection.sendRequest(ApplyWorkspaceEditRequest.type, {
      label: editLabel,
      edit: workspaceEdit,
    });
  }
}
