import { LiquidHtmlNode } from '@platformos/liquid-html-parser';
import { DefinitionParams, DefinitionLink } from 'vscode-languageserver-protocol';

export interface BaseDefinitionProvider {
  definitions(
    params: DefinitionParams,
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
  ): Promise<DefinitionLink[]>;
}
