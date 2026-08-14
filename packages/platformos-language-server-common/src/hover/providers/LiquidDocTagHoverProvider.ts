import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode, PlatformOSDocset } from '@platformos/platformos-check-common';
import { Hover, HoverParams, MarkupKind } from 'vscode-languageserver';
import { BaseHoverProvider } from '../BaseHoverProvider';
import { formatLiquidDocTagHandle } from '../../utils/liquidDoc';
import { DocumentManager } from '../../documents';

/**
 * Describes a `{% doc %}` annotation from the DOCSET's prose and example.
 *
 * An annotation the docset does not publish gets no hover, which is also what happens when the docset
 * predates the vocabulary: it goes quiet rather than describing a name from a list of its own.
 */
export class LiquidDocTagHoverProvider implements BaseHoverProvider {
  constructor(
    private documentManager: DocumentManager,
    private platformosDocset: PlatformOSDocset,
  ) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const parentNode = ancestors.at(-1);

    if (
      currentNode.type !== NodeTypes.LiquidDocParamNode &&
      currentNode.type !== NodeTypes.LiquidDocDescriptionNode &&
      currentNode.type !== NodeTypes.LiquidDocExampleNode
    ) {
      return null;
    }

    const document = this.documentManager.get(params.textDocument.uri)?.textDocument;

    // We only want to provide hover when we are on the exact tag name
    // If the cursor is passed that but still within the tag node, we ignore it
    //
    // E.g.
    // Provide hover: @para█m name - description
    // Don't provide hover: @param █name - description
    if (
      document &&
      document.offsetAt(params.position) > currentNode.position.start + currentNode.name.length
    ) {
      return null;
    }

    const { annotations } = await this.platformosDocset.liquidDoc();
    const annotation = annotations.find(({ name }) => name === currentNode.name);

    if (!annotation) {
      return null;
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: formatLiquidDocTagHandle(
          annotation.name,
          annotation.description,
          annotation.example,
        ),
      },
    };
  }
}
