import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidHtmlNode } from '@platformos/theme-check-common';
import { Hover, HoverParams } from 'vscode-languageserver';
import {
  TypeSystem,
  Unknown,
  Untyped,
  isArrayType,
  isShapeType,
  isUnionType,
  typeToDisplayString,
} from '../../TypeSystem';
import { shapeToTypeString, shapeToDetailString } from '../../PropertyShapeInference';
import { render } from '../../docset';
import { BaseHoverProvider } from '../BaseHoverProvider';

export class LiquidObjectAttributeHoverProvider implements BaseHoverProvider {
  constructor(private typeSystem: TypeSystem) {}

  async hover(
    currentNode: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
    params: HoverParams,
  ): Promise<Hover | null> {
    const parentNode = ancestors.at(-1);
    const uri = params.textDocument.uri;
    if (
      currentNode.type !== NodeTypes.String ||
      !parentNode ||
      parentNode.type !== NodeTypes.VariableLookup ||
      !parentNode.lookups.includes(currentNode)
    ) {
      return null;
    }

    const lookupIndex = parentNode.lookups.findIndex((lookup) => lookup === currentNode);
    const node = {
      ...parentNode,
      lookups: parentNode.lookups.slice(0, lookupIndex),
    };

    const objectMap = await this.typeSystem.objectMap(uri, ancestors[0]);
    const parentType = await this.typeSystem.inferType(node, ancestors[0], uri);

    // Handle ShapeType from parse_json, graphql, hash_assign
    if (isShapeType(parentType)) {
      const nodeType = await this.typeSystem.inferType(
        { ...parentNode, lookups: parentNode.lookups.slice(0, lookupIndex + 1) },
        ancestors[0],
        uri,
      );

      // Return hover info for shape types
      if (isShapeType(nodeType)) {
        return {
          contents: {
            kind: 'markdown',
            value: `### ${currentNode.value}: \`${shapeToTypeString(nodeType.shape)}\`\n${shapeToDetailString(nodeType.shape)}`,
          },
        };
      }

      // Handle primitive types from shape lookup
      if (nodeType !== Unknown && nodeType !== Untyped && !isArrayType(nodeType)) {
        return {
          contents: {
            kind: 'markdown',
            value: `### ${currentNode.value}: \`${nodeType}\``,
          },
        };
      }

      if (nodeType === Unknown) return null;

      return {
        contents: {
          kind: 'markdown',
          value: `### ${currentNode.value}: \`${isArrayType(nodeType) ? `${nodeType.valueType}[]` : nodeType}\``,
        },
      };
    }

    if (
      isArrayType(parentType) ||
      parentType === 'string' ||
      parentType === Untyped ||
      isUnionType(parentType)
    ) {
      const nodeType = await this.typeSystem.inferType(
        { ...parentNode, lookups: parentNode.lookups.slice(0, lookupIndex + 1) },
        ancestors[0],
        uri,
      );

      // 2D arrays, unknown types and shape types are handled differently
      if (isArrayType(nodeType) || nodeType === Unknown) return null;

      if (isShapeType(nodeType)) {
        return {
          contents: {
            kind: 'markdown',
            value: `### ${currentNode.value}: \`${shapeToTypeString(nodeType.shape)}\`\n${shapeToDetailString(nodeType.shape)}`,
          },
        };
      }

      if (isUnionType(nodeType)) {
        return {
          contents: {
            kind: 'markdown',
            value: `### ${currentNode.value}: \`${typeToDisplayString(nodeType)}\``,
          },
        };
      }

      // We want want `## first: `nodeType` with the docs of the nodeType
      const entry = { ...(objectMap[nodeType] ?? {}), name: currentNode.value };

      return {
        contents: {
          kind: 'markdown',
          value: render(entry, nodeType),
        },
      };
    }

    // UnionType doesn't have properties, so return null if it reaches here
    if (isUnionType(parentType)) {
      return null;
    }

    const parentEntry = objectMap[parentType];
    if (!parentEntry) {
      return null;
    }

    const parentTypeProperties = objectMap[parentType]?.properties || [];
    const entry = parentTypeProperties.find((p: { name: string }) => p.name === currentNode.value);
    if (!entry) {
      return null;
    }

    return {
      contents: {
        kind: 'markdown',
        value: render(entry),
      },
    };
  }
}
