import { LiquidTag, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
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
import { isPartial, partialName } from '../../utils/uri';
import { BaseRenameHandler } from '../BaseRenameHandler';
import { FindAppRootURI } from '../../internal-types';

/**
 * The PartialRenameHandler will handle partial renames.
 *
 * We'll change all the render and include tags that reference the old partial
 * to reference the new partial.
 *
 *   {% render 'oldName' %} -> {% render 'newName' %}
 *
 * We'll do this by visiting all the liquid files in the app and looking for
 * render and include tags that reference the old partial. We'll then create a
 * WorkspaceEdit that changes the references to the new partial.
 */
export class PartialRenameHandler implements BaseRenameHandler {
  constructor(
    private documentManager: DocumentManager,
    private connection: Connection,
    private capabilities: ClientCapabilities,
    private findAppRootURI: FindAppRootURI,
  ) {}

  async onDidRenameFiles(params: RenameFilesParams): Promise<void> {
    if (!this.capabilities.hasApplyEditSupport) return;
    const relevantRenames = params.files.filter(
      (file) => isPartial(file.oldUri) && isPartial(file.newUri),
    );

    // Only preload if you have something to do (folder renames are not supported)
    if (relevantRenames.length !== 1) return;
    const rename = relevantRenames[0];
    const rootUri = await this.findAppRootURI(path.dirname(params.files[0].oldUri));
    if (!rootUri) return;
    await this.documentManager.preload(rootUri);
    const app = this.documentManager.app(rootUri, true);
    const liquidSourceCodes = app.filter(isLiquidSourceCode);
    const oldPartialName = partialName(rename.oldUri);
    const newPartialName = partialName(rename.newUri);
    const editLabel = `Rename partial '${oldPartialName}' to '${newPartialName}'`;
    const annotationId = 'renamePartial';
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
        async LiquidTag(node: LiquidTag) {
          if (node.name !== NamedTags.render && node.name !== NamedTags.include) {
            return;
          }
          if (typeof node.markup === 'string') {
            return;
          }
          const partial = node.markup.partial;
          if (partial.type === NodeTypes.String && partial.value === oldPartialName) {
            return {
              newText: `${newPartialName}`,
              range: Range.create(
                textDocument.positionAt(partial.position.start + 1), // +1 to skip the opening quote
                textDocument.positionAt(partial.position.end - 1), // -1 to skip the closing quote
              ),
            };
          }
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
