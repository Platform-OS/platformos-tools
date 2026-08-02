import { NodeTypes } from '@platformos/liquid-html-parser';
import { CompletionItem, CompletionItemKind, MarkupKind } from 'vscode-languageserver';
import { LiquidCompletionParams } from '../params';
import { Provider } from './common';
import { filePathSupportsLiquidDoc } from '@platformos/platformos-check-common';
import { FindAppRootURI } from '../../internal-types';
import {
  getValidParamTypes,
  SupportedDocTagTypes,
  PlatformOSDocset,
} from '@platformos/platformos-check-common';

export class LiquidDocParamTypeCompletionProvider implements Provider {
  constructor(
    private readonly platformosDocset: PlatformOSDocset,
    private readonly findAppRootURI?: FindAppRootURI,
  ) {}

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    if (!params.completionContext) return [];
    if (!(await this.supportsLiquidDoc(params.document.uri))) return [];

    const { node, ancestors } = params.completionContext;
    const parentNode = ancestors.at(-1);

    if (
      !node ||
      !parentNode ||
      node.type !== NodeTypes.TextNode ||
      parentNode.type !== NodeTypes.LiquidRawTag ||
      parentNode.name !== 'doc'
    ) {
      return [];
    }

    /**
     * We need to make sure we're trying to code complete after
     * the param tag's `{` character.
     *
     * We will be removing any spaces in case there are any formatting issues.
     */
    const fragments = node.value.split(' ').filter(Boolean);
    if (
      fragments.length > 2 ||
      fragments[0] !== `@${SupportedDocTagTypes.Param}` ||
      !/^\{[a-zA-Z]*$/.test(fragments[1])
    ) {
      return [];
    }

    const liquidDrops = await this.platformosDocset.liquidDrops();

    return Array.from(getValidParamTypes(liquidDrops)).map(([label, description]) => {
      const documentation = description
        ? {
            kind: MarkupKind.Markdown,
            value: description,
          }
        : undefined;

      return {
        label,
        kind: CompletionItemKind.EnumMember,
        insertText: label,
        documentation,
      };
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
