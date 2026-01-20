import { LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';

export type GetPartialNamesForURI = (uri: string, partial: string, tag: string|undefined) => Promise<string[]>;

export class PartialCompletionProvider implements Provider {
  constructor(private readonly getPartialNamesForURI: GetPartialNamesForURI = async () => []) {}

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    if (!params.completionContext) return [];

    const { node, ancestors } = params.completionContext;
    const parentNode = ancestors.at(-1);

    if (
      !node ||
      !parentNode ||
      node.type !== NodeTypes.String ||
      ![NodeTypes.RenderMarkup, NodeTypes.GraphQLMarkup, NodeTypes.FunctionMarkup].includes(parentNode.type)
    ) {
      return [];
    }

    const partial = node.value;
    const options = await this.getPartialNamesForURI(params.textDocument.uri, partial, (ancestors.at(-2) as LiquidTag)?.name || undefined);

    return options
      .map(
        (option: string): CompletionItem => ({
          label: option,
          kind: CompletionItemKind.Snippet,
          documentation: {
            kind: 'markdown',
            value: option,
          },
        }),
      );
  }
}
