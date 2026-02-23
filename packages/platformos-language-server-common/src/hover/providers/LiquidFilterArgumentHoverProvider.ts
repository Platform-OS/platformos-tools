import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode, PlatformOSDocset } from '@platformos/platformos-check-common';
import { Hover } from 'vscode-languageserver';
import { render } from '../../docset';
import { BaseHoverProvider } from '../BaseHoverProvider';

export class LiquidFilterArgumentHoverProvider implements BaseHoverProvider {
  constructor(private platformosDocset: PlatformOSDocset) {}

  async hover(currentNode: LiquidHtmlNode, ancestors: LiquidHtmlNode[]): Promise<Hover | null> {
    const parentNode = ancestors.at(-1);

    if (
      !parentNode ||
      parentNode.type !== NodeTypes.LiquidFilter ||
      currentNode.type !== NodeTypes.NamedArgument
    ) {
      return null;
    }

    const parentName = parentNode.name;
    const entries = await this.platformosDocset.filters();
    const entry = entries.find((entry) => entry.name === parentName);

    if (!entry) {
      return null;
    }

    const argument = entry.parameters?.find((argument) => argument.name === currentNode.name);

    if (!argument) {
      return null;
    }

    return {
      contents: {
        kind: 'markdown',
        value: render(argument, undefined, 'filter'),
      },
    };
  }
}
