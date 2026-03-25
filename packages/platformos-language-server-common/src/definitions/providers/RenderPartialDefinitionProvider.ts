import { LiquidHtmlNode, LiquidString, LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';
import { DocumentsLocator, DocumentType } from '@platformos/platformos-common';
import {
  DefinitionParams,
  DefinitionLink,
  Range,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { DocumentManager } from '../../documents';
import { BaseDefinitionProvider } from '../BaseDefinitionProvider';
import { SearchPathsLoader } from '../../utils/searchPaths';

const TAG_MARKUP_TYPE: Record<string, NodeTypes> = {
  render: NodeTypes.RenderMarkup,
  include: NodeTypes.RenderMarkup,
  theme_render_rc: NodeTypes.RenderMarkup,
  function: NodeTypes.FunctionMarkup,
  graphql: NodeTypes.GraphQLMarkup,
};

export class RenderPartialDefinitionProvider implements BaseDefinitionProvider {
  constructor(
    private documentManager: DocumentManager,
    private documentsLocator: DocumentsLocator,
    private searchPathsCache: SearchPathsLoader,
    private findAppRootURI: (uri: string) => Promise<string | null>,
  ) {}

  async definitions(
    params: DefinitionParams,
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
  ): Promise<DefinitionLink[]> {
    if (node.type !== NodeTypes.String) return [];

    const markup = ancestors.at(-1);
    const tag = ancestors.at(-2);
    if (!markup || !tag || tag.type !== NodeTypes.LiquidTag) return [];

    const expectedMarkupType = TAG_MARKUP_TYPE[(tag as LiquidTag).name];
    if (expectedMarkupType === undefined || markup.type !== expectedMarkupType) return [];

    const rootUri = await this.findAppRootURI(params.textDocument.uri);
    if (!rootUri) return [];

    const root = URI.parse(rootUri);
    const searchPaths = await this.searchPathsCache.get(root);
    const docType = (tag as LiquidTag).name as DocumentType;
    const fileUri = await this.documentsLocator.locateOrDefault(
      root,
      docType,
      (node as LiquidString).value,
      searchPaths,
    );
    if (!fileUri) return [];

    const sourceCode = this.documentManager.get(params.textDocument.uri);
    if (!sourceCode) return [];

    const doc = sourceCode.textDocument;
    const originRange = Range.create(
      doc.positionAt(node.position.start),
      doc.positionAt(node.position.end),
    );
    const targetRange = Range.create(0, 0, 0, 0);

    return [LocationLink.create(fileUri, targetRange, targetRange, originRange)];
  }
}
