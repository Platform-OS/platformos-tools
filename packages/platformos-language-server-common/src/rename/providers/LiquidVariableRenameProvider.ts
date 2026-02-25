import {
  AssignMarkup,
  ForMarkup,
  LiquidHtmlNode,
  LiquidTagFor,
  LiquidTagTablerow,
  LiquidVariableLookup,
  NamedTags,
  NodeTypes,
  Position,
  RenderMarkup,
  TextNode,
} from '@platformos/liquid-html-parser';
import {
  GraphQLDocumentNode,
  JSONNode,
  SourceCodeType,
  visit,
} from '@platformos/platformos-check-common';
import { Connection, Range } from 'vscode-languageserver';
import {
  ApplyWorkspaceEditRequest,
  PrepareRenameParams,
  PrepareRenameResult,
  RenameParams,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ClientCapabilities } from '../../ClientCapabilities';
import { AugmentedLiquidSourceCode, DocumentManager, isLiquidSourceCode } from '../../documents';
import { FindAppRootURI } from '../../internal-types';
import { partialName } from '../../utils/uri';
import { BaseRenameProvider } from '../BaseRenameProvider';

export class LiquidVariableRenameProvider implements BaseRenameProvider {
  constructor(
    private connection: Connection,
    private clientCapabilities: ClientCapabilities,
    private documentManager: DocumentManager,
    private findAppRootURI: FindAppRootURI,
  ) {}

  async prepare(
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: PrepareRenameParams,
  ): Promise<null | PrepareRenameResult> {
    const document = this.documentManager.get(params.textDocument.uri);
    const textDocument = document?.textDocument;

    if (!textDocument || !node || !ancestors) return null;
    if (!supportedTags(node, ancestors)) return null;

    const oldName = variableName(node);
    const offsetOfVariableNameEnd = node.position.start + oldName.length;

    // The cursor could be past the end of the variable name
    if (textDocument.offsetAt(params.position) > offsetOfVariableNameEnd) return null;

    return {
      range: Range.create(
        textDocument.positionAt(node.position.start),
        textDocument.positionAt(offsetOfVariableNameEnd),
      ),
      placeholder: oldName,
    };
  }

  async rename(
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: RenameParams,
  ): Promise<null | WorkspaceEdit> {
    const document = this.documentManager.get(params.textDocument.uri);
    const rootUri = await this.findAppRootURI(params.textDocument.uri);
    const textDocument = document?.textDocument;

    if (!rootUri || !textDocument || !node || !ancestors) return null;
    if (document.ast instanceof Error) return null;
    if (!supportedTags(node, ancestors)) return null;

    const oldName = variableName(node);
    const scope = variableNameBlockScope(oldName, ancestors);
    const replaceRange = textReplaceRange(oldName, textDocument, scope);

    let liquidDocParamUpdated = false;

    const ranges: Range[] = await visit(document.ast, {
      VariableLookup: replaceRange,
      AssignMarkup: replaceRange,
      ForMarkup: replaceRange,
      TextNode: async (
        node: LiquidHtmlNode,
        ancestors: (LiquidHtmlNode | JSONNode | GraphQLDocumentNode)[],
      ) => {
        if (ancestors.at(-1)?.type !== NodeTypes.LiquidDocParamNode) return;

        liquidDocParamUpdated = true;

        return await replaceRange(node, ancestors);
      },
    });

    if (this.clientCapabilities.hasApplyEditSupport && liquidDocParamUpdated) {
      const appFiles = this.documentManager.app(rootUri, true);
      const liquidSourceCodes = appFiles.filter(isLiquidSourceCode);
      const name = partialName(params.textDocument.uri);

      await updateRenderTags(this.connection, liquidSourceCodes, name, oldName, params.newName);
    }

    const textDocumentEdit = TextDocumentEdit.create(
      { uri: textDocument.uri, version: textDocument.version },
      ranges.map((range) => TextEdit.replace(range, params.newName)),
    );

    return {
      documentChanges: [textDocumentEdit],
    };
  }
}

function supportedTags(
  node: LiquidHtmlNode,
  ancestors: LiquidHtmlNode[],
): node is AssignMarkup | LiquidVariableLookup | ForMarkup | TextNode {
  return (
    node.type === NodeTypes.AssignMarkup ||
    node.type === NodeTypes.VariableLookup ||
    node.type === NodeTypes.ForMarkup ||
    isLiquidDocParamNameNode(node, ancestors)
  );
}

function isLiquidDocParamNameNode(
  node: LiquidHtmlNode,
  ancestors: LiquidHtmlNode[],
): node is TextNode {
  const parentNode = ancestors.at(-1);

  return (
    !!parentNode &&
    parentNode.type === NodeTypes.LiquidDocParamNode &&
    parentNode.paramName === node &&
    node.type === NodeTypes.TextNode
  );
}

function variableName(node: LiquidHtmlNode): string {
  switch (node.type) {
    case NodeTypes.VariableLookup:
    case NodeTypes.AssignMarkup:
      return node.name ?? '';
    case NodeTypes.ForMarkup:
      return node.variableName ?? '';
    case NodeTypes.TextNode:
      return node.value;
    default:
      return '';
  }
}

/*
 * Find the scope where the variable name is used. Looks at defined in `tablerow` and `for` tags.
 */
function variableNameBlockScope(
  variableName: string,
  ancestors: (LiquidHtmlNode | JSONNode | GraphQLDocumentNode)[],
): Position | undefined {
  let scopedAncestor: LiquidTagTablerow | LiquidTagFor | undefined;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (
      ancestor.type === NodeTypes.LiquidTag &&
      (ancestor.name === NamedTags.tablerow || ancestor.name === NamedTags.for) &&
      typeof ancestor.markup !== 'string' &&
      ancestor.markup.variableName === variableName
    ) {
      scopedAncestor = ancestor as LiquidTagTablerow | LiquidTagFor;
      break;
    }
  }

  if (!scopedAncestor || !scopedAncestor.blockEndPosition) return;

  return {
    start: scopedAncestor.blockStartPosition.start,
    end: scopedAncestor.blockEndPosition.end,
  };
}

function textReplaceRange(
  oldName: string,
  textDocument: TextDocument,
  selectedVariableScope?: Position,
) {
  return async (
    node: LiquidHtmlNode,
    ancestors: (LiquidHtmlNode | JSONNode | GraphQLDocumentNode)[],
  ) => {
    if (variableName(node) !== oldName) return;

    const ancestorScope = variableNameBlockScope(oldName, ancestors);
    if (
      ancestorScope?.start !== selectedVariableScope?.start ||
      ancestorScope?.end !== selectedVariableScope?.end
    ) {
      return;
    }

    return Range.create(
      textDocument.positionAt(node.position.start),
      textDocument.positionAt(node.position.start + oldName.length),
    );
  };
}

async function updateRenderTags(
  connection: Connection,
  liquidSourceCodes: AugmentedLiquidSourceCode[],
  partialName: string,
  oldParamName: string,
  newParamName: string,
) {
  const editLabel = `Rename partial parameter '${oldParamName}' to '${newParamName}'`;
  const annotationId = 'renamePartialParameter';
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
      async RenderMarkup(node: RenderMarkup) {
        if (node.partial.type !== NodeTypes.String || node.partial.value !== partialName) {
          return;
        }

        const renamedNameParamNode = node.args.find((arg) => arg.name === oldParamName);

        if (renamedNameParamNode) {
          return {
            newText: `${newParamName}: `,
            range: Range.create(
              textDocument.positionAt(renamedNameParamNode.position.start),
              textDocument.positionAt(renamedNameParamNode.value.position.start),
            ),
          };
        }

        if (node.alias?.value === oldParamName && node.variable) {
          // `as variable` is not captured in our liquid parser yet,
          // so we have to check it manually and replace it
          const aliasMatch = /as\s+([^\s,]+)/g;
          const match = aliasMatch.exec(node.source.slice(node.position.start, node.position.end));

          if (!match) return;

          return {
            newText: `as ${newParamName}`,
            range: Range.create(
              textDocument.positionAt(node.position.start + match.index),
              textDocument.positionAt(node.position.start + match.index + match[0].length),
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

  await connection.sendRequest(ApplyWorkspaceEditRequest.type, {
    label: editLabel,
    edit: workspaceEdit,
  });
}
