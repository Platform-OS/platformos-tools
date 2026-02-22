import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode, PlatformOSDocset } from '@platformos/platformos-check-common';
import { Hover } from 'vscode-languageserver';
import { render } from '../../docset';
import { BaseHoverProvider } from '../BaseHoverProvider';

export class LiquidTagHoverProvider implements BaseHoverProvider {
  constructor(public platformosDocset: PlatformOSDocset) {}

  async hover(currentNode: LiquidHtmlNode): Promise<Hover | null> {
    if (
      currentNode.type !== NodeTypes.LiquidTag &&
      currentNode.type !== NodeTypes.LiquidRawTag &&
      currentNode.type !== NodeTypes.LiquidBranch
    ) {
      return null;
    }

    const name = currentNode.name;
    const entries = await this.platformosDocset.tags();
    const entry = entries.find((entry) => entry.name === name);
    if (!entry) {
      return null;
    }

    return {
      contents: {
        kind: 'markdown',
        value: render(entry, undefined, 'tag'),
      },
    };
  }
}
