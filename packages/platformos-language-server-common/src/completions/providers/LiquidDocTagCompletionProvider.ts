import { NodeTypes } from '@platformos/liquid-html-parser';
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';
import { formatLiquidDocTagHandle, SUPPORTED_LIQUID_DOC_TAG_HANDLES } from '../../utils/liquidDoc';
import { filePathSupportsLiquidDoc } from '@platformos/platformos-check-common';
import { FindAppRootURI } from '../../internal-types';

export class LiquidDocTagCompletionProvider implements Provider {
  constructor(private readonly findAppRootURI?: FindAppRootURI) {}

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
      case NodeTypes.LiquidDocPromptNode:
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

  private createCompletionItems(userInput: string): CompletionItem[] {
    // Need to offset the '@' symbol by 1
    const offsetInput = userInput.slice(1);
    const entries = Object.entries(SUPPORTED_LIQUID_DOC_TAG_HANDLES).filter(
      ([label]) => !offsetInput || label.startsWith(offsetInput),
    );

    return entries.map(([label, { description, example, template }]) => {
      const item: CompletionItem = {
        label,
        kind: CompletionItemKind.EnumMember,
        documentation: {
          kind: MarkupKind.Markdown,
          value: formatLiquidDocTagHandle(label, description, example),
        },
        insertText: template,
        insertTextFormat: InsertTextFormat.Snippet,
      };

      return item;
    });
  }

  /**
   * Whether the file at `uri` is one `{% doc %}` applies to — a partial.
   *
   * Needs the project root, which only the server can resolve, so it arrives as an
   * injected resolver. Without one the provider cannot tell a partial from a page in
   * some unrelated directory, and offers nothing rather than guessing.
   */
  private async supportsLiquidDoc(uri: string): Promise<boolean> {
    const rootUri = this.findAppRootURI ? await this.findAppRootURI(uri) : undefined;
    return !!rootUri && filePathSupportsLiquidDoc(uri, rootUri);
  }
}
