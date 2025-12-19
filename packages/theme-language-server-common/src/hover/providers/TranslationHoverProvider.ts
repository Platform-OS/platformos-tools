import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode } from '@platformos/theme-check-common';
import { Hover, HoverParams } from 'vscode-languageserver';
import { DocumentManager } from '../../documents';
import { renderTranslation } from '../../translations';
import { BaseHoverProvider } from '../BaseHoverProvider';
import { TranslationProvider } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { FindThemeRootURI } from '../../../src/internal-types';

export class TranslationHoverProvider implements BaseHoverProvider {
  constructor(
    public documentManager: DocumentManager,
    private translationProvider: TranslationProvider,
    private findThemeRootURI: FindThemeRootURI
  ) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const parentNode = ancestors.at(-1);
    if (
      currentNode.type !== NodeTypes.String ||
      !parentNode ||
      parentNode.type !== NodeTypes.LiquidVariable
    ) {
      return null;
    }

    if (!parentNode.filters[0] || !['t', 'translate'].includes(parentNode.filters[0].name)) {
      return null;
    }
    
    const root = await this.findThemeRootURI(params.textDocument.uri)
    if(!root) {
      return null;
    }
    const translation = await this.translationProvider.translate(URI.parse(root), currentNode.value, 'en')
    const document = this.documentManager.get(params.textDocument.uri)?.textDocument;
    if (!translation || !document) {
      return null;
    }

    return {
      contents: {
        kind: 'markdown',
        value: renderTranslation(translation),
      },
      range: {
        start: document.positionAt(currentNode.position.start),
        end: document.positionAt(currentNode.position.end),
      },
    };
  }
}
