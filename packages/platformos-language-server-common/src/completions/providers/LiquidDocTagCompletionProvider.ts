import { NodeTypes } from '@platformos/liquid-html-parser';
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import { PlatformOSDocset } from '@platformos/platformos-check-common';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';
import { formatLiquidDocTagHandle, liquidDocAnnotationSnippet } from '../../utils/liquidDoc';
import { FileTypeForURI } from '../../internal-types';
import { makeSupportsLiquidDoc } from '../../utils/uri';

/**
 * Offers the `{% doc %}` annotations the DOCSET publishes.
 *
 * The list, the prose and the worked example used to be a table in this package. A docset that
 * publishes none — every docset older than `liquid_doc.json` — offers nothing, rather than offering a
 * list this repository invented.
 */
export class LiquidDocTagCompletionProvider implements Provider {
  private readonly supportsLiquidDoc: (uri: string) => Promise<boolean>;

  constructor(
    private readonly platformosDocset: PlatformOSDocset,
    fileTypeForURI?: FileTypeForURI,
  ) {
    this.supportsLiquidDoc = makeSupportsLiquidDoc(fileTypeForURI);
  }

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    if (!params.completionContext) return [];
    if (!(await this.supportsLiquidDoc(params.document.uri))) return [];

    const { node, ancestors } = params.completionContext;
    const parentNode = ancestors.at(-1);

    if (
      !node ||
      !parentNode ||
      parentNode.type !== NodeTypes.LiquidRawTag ||
      parentNode.name !== 'doc'
    ) {
      return [];
    }

    switch (node.type) {
      case NodeTypes.TextNode:
        if (!node.value.startsWith('@')) {
          return [];
        }
        return this.createCompletionItems(node.value);
      case NodeTypes.LiquidDocDescriptionNode:
      case NodeTypes.LiquidDocExampleNode:
        // These nodes accept free-form text, so we only suggest completions if the last line starts with '@'
        const lastLine = node.content.value.split('\n').at(-1)?.trim();
        if (!lastLine?.startsWith('@')) {
          return [];
        }
        return this.createCompletionItems(lastLine);
      default:
        return [];
    }
  }

  private async createCompletionItems(userInput: string): Promise<CompletionItem[]> {
    const { annotations } = await this.platformosDocset.liquidDoc();
    // Need to offset the '@' symbol by 1
    const offsetInput = userInput.slice(1);

    return annotations
      .filter(({ name }) => !offsetInput || name.startsWith(offsetInput))
      .map(({ name, description, example }) => ({
        label: name,
        kind: CompletionItemKind.EnumMember,
        documentation: {
          kind: MarkupKind.Markdown,
          value: formatLiquidDocTagHandle(name, description, example),
        },
        insertText: liquidDocAnnotationSnippet(name),
        insertTextFormat: InsertTextFormat.Snippet,
      }));
  }
}
