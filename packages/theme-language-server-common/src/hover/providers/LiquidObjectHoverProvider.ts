import { LiquidHtmlNode, LiquidVariableLookup, NodeTypes } from '@platformos/liquid-html-parser';
import { Hover, HoverParams } from 'vscode-languageserver';
import { TypeSystem, Unknown, Untyped, isArrayType, isShapeType } from '../../TypeSystem';
import { render } from '../../docset';
import { BaseHoverProvider } from '../BaseHoverProvider';

export class LiquidObjectHoverProvider implements BaseHoverProvider {
  constructor(private typeSystem: TypeSystem) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    if (
      currentNode.type !== NodeTypes.VariableLookup &&
      currentNode.type !== NodeTypes.AssignMarkup
    ) {
      return null;
    }

    if (!currentNode.name) {
      return null;
    }

    let node = currentNode;
    if (node.type === NodeTypes.VariableLookup) {
      node = {
        ...currentNode,
        lookups: [],
      } as LiquidVariableLookup;
    }

    const type = await this.typeSystem.inferType(node, ancestors[0], params.textDocument.uri);
    const objectMap = await this.typeSystem.objectMap(params.textDocument.uri, ancestors[0]);

    if (type === Unknown) {
      return null;
    }

    // Handle ShapeType from parse_json, graphql, hash_assign
    if (isShapeType(type)) {
      return {
        contents: {
          kind: 'markdown',
          value: render({ name: currentNode.name }, type, 'object'),
        },
      };
    }

    const entryType = isArrayType(type) ? type.valueType : type;
    const entry = objectMap[entryType];

    if (!entry) {
      const entryByName = objectMap[currentNode.name] ?? {};
      return {
        contents: {
          kind: 'markdown',
          value: render(
            {
              ...entryByName,
              name: currentNode.name,
            },
            type,
            'object',
          ),
        },
      };
    }

    return {
      contents: {
        kind: 'markdown',
        value: render({ ...entry, name: currentNode.name }, type, 'object'),
      },
    };
  }
}
