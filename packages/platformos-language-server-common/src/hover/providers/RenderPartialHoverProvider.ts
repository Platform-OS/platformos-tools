import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode, GetDocDefinitionForURI } from '@platformos/platformos-check-common';
import { Hover, HoverParams } from 'vscode-languageserver';
import { BaseHoverProvider } from '../BaseHoverProvider';
import { formatLiquidDocContentMarkdown } from '../../utils/liquidDoc';

export class RenderPartialHoverProvider implements BaseHoverProvider {
  constructor(private getDocDefinitionForURI: GetDocDefinitionForURI) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const parentNode = ancestors.at(-1);
    if (
      currentNode.type !== NodeTypes.String ||
      !parentNode ||
      parentNode.type !== NodeTypes.RenderMarkup
    ) {
      return null;
    }

    const partialName = currentNode.value;
    const docDefinition = await this.getDocDefinitionForURI(
      params.textDocument.uri,
      'app/views/partials',
      partialName,
    );

    return {
      contents: {
        kind: 'markdown',
        value: formatLiquidDocContentMarkdown(partialName, docDefinition),
      },
    };
  }
}
