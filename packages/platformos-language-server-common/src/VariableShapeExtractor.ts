import {
  NodeTypes,
  LiquidHtmlNode,
  LiquidTag,
  LiquidExpression,
  LiquidVariableLookup,
  NamedTags,
  TextNode,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  LiquidString,
  HashAssignMarkup,
} from '@platformos/liquid-html-parser';
import { visit, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import {
  PropertyShape,
  inferShapeFromJSONString,
  inferShapeFromGraphQL,
} from './PropertyShapeInference';

export interface VariableShapeEntry {
  name: string;
  shape: PropertyShape;
  range: [start: number, end?: number];
}

/**
 * Extract variable shapes from JSON literals, parse_json, and graphql tags in the AST
 */
export async function extractVariableShapes(
  ast: LiquidHtmlNode,
  fs?: AbstractFileSystem,
  documentsLocator?: DocumentsLocator,
  rootUri?: string,
  graphqlSchema?: string,
): Promise<VariableShapeEntry[]> {
  const shapes: VariableShapeEntry[] = [];

  // Helper to close previous shape ranges when a variable is reassigned
  const closeShapeRange = (variableName: string, endPosition: number) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (shapes[i].name === variableName && shapes[i].range[1] === undefined) {
        shapes[i].range[1] = endPosition;
        break;
      }
    }
  };

  await visit<SourceCodeType.LiquidHtml, void>(ast, {
    async LiquidTag(node: LiquidTag) {
      // {% assign x = '[{"a": 3}]' | parse_json %}
      // {% assign x = var | default: '{"fallback": true}' | parse_json %}
      if (isLiquidTagAssign(node)) {
        const markup = node.markup;

        // Close any previous shape for this variable (reassignment)
        // Use node.position.end so RHS can still reference old value (e.g., a = a.b)
        closeShapeRange(markup.name, node.position.end);

        const hasParseJsonFilter =
          markup.value.filters &&
          markup.value.filters.some(
            (f: { name: string }) => f.name === 'parse_json' || f.name === 'to_hash',
          );

        if (hasParseJsonFilter) {
          let jsonString: string | undefined;

          // Check if expression is a direct JSON string
          if (markup.value.expression.type === NodeTypes.String) {
            jsonString = markup.value.expression.value;
          }

          // Check if there's a default filter with a JSON string argument
          if (!jsonString && markup.value.filters) {
            const defaultFilter = markup.value.filters.find(
              (f: { name: string }) => f.name === 'default',
            );
            if (defaultFilter && defaultFilter.args && defaultFilter.args.length > 0) {
              const firstArg = defaultFilter.args[0];
              if (firstArg.type === NodeTypes.String) {
                jsonString = firstArg.value;
              }
            }
          }

          if (jsonString) {
            const shape = inferShapeFromJSONString(jsonString);
            if (shape) {
              shapes.push({
                name: markup.name,
                shape,
                range: [node.position.end],
              });
            }
          }
        }
      }

      // {% parse_json x %}{"a": 5}{% endparse_json %}
      if (isLiquidTagParseJson(node)) {
        const variableName = node.markup.name;
        if (variableName && node.children) {
          // Close any previous shape for this variable (reassignment)
          closeShapeRange(variableName, node.position.end);

          const textContent = node.children
            .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
            .map((c) => c.value)
            .join('');
          const shape = inferShapeFromJSONString(textContent);
          if (shape) {
            shapes.push({
              name: variableName,
              shape,
              range: [node.blockEndPosition?.end ?? node.position.end],
            });
          }
        }
      }

      // {% graphql result %}...inline graphql...{% endgraphql %} (inline)
      if (isLiquidTagGraphQL(node) && isGraphQLInlineMarkup(node.markup)) {
        const markup = node.markup;
        // Close any previous shape for this variable (reassignment)
        closeShapeRange(markup.name, node.position.end);

        if (node.children) {
          const textContent = node.children
            .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
            .map((c) => c.value)
            .join('');
          const shape = inferShapeFromGraphQL(textContent, graphqlSchema);
          if (shape) {
            shapes.push({
              name: markup.name,
              shape,
              range: [node.blockEndPosition?.end ?? node.position.end],
            });
          }
        }
      }

      // {% graphql result = 'file' %} (file-based)
      if (isLiquidTagGraphQL(node) && isGraphQLFileMarkup(node.markup)) {
        const markup = node.markup;
        // Close any previous shape for this variable (reassignment)
        closeShapeRange(markup.name, node.position.end);

        if (fs && documentsLocator && rootUri && isLiquidString(markup.graphql)) {
          const graphqlFile = markup.graphql.value;
          try {
            const located = await documentsLocator.locate(
              URI.parse(rootUri),
              'graphql',
              graphqlFile,
            );
            if (located) {
              const content = await fs.readFile(located);
              const shape = inferShapeFromGraphQL(content, graphqlSchema);
              if (shape) {
                shapes.push({
                  name: markup.name,
                  shape,
                  range: [node.position.end],
                });
              }
            }
          } catch {
            // File read error - skip
          }
        }
      }

      // {% hash_assign x["key"] = value %} or {% hash_assign x["a"]["b"] = value %}
      // Also handles {% hash_assign a = value %} (no lookups, works like assign)
      if (isLiquidTagHashAssign(node)) {
        const markup = node.markup;
        const variableName = markup.target.name;
        const lookupPath = getHashAssignLookupPath(markup);

        // Determine value shape - check if value is a JSON string with parse_json filter
        let valueShape: PropertyShape | undefined;
        if (markup.value.expression.type === NodeTypes.String) {
          const hasParseJsonFilter = markup.value.filters.some(
            (f) => f.name === 'parse_json' || f.name === 'to_hash',
          );
          if (hasParseJsonFilter) {
            valueShape = inferShapeFromJSONString(markup.value.expression.value) ?? undefined;
          }
        }

        if (variableName && lookupPath && lookupPath.length > 0) {
          // Nested property assignment: {% hash_assign a['key'] = value %}
          const existingIdx = findLastApplicableShapeIndex(
            variableName,
            node.position.start,
            shapes,
          );

          if (existingIdx !== -1) {
            const existing = shapes[existingIdx];
            const newShape = mergeNestedPropertyIntoShape(
              existing.shape,
              lookupPath,
              valueShape ?? { kind: 'primitive' },
            );
            shapes.push({
              name: variableName,
              shape: newShape,
              range: [node.position.end],
            });
          } else {
            const newShape = mergeNestedPropertyIntoShape(
              { kind: 'object', properties: new Map() },
              lookupPath,
              valueShape ?? { kind: 'primitive' },
            );
            shapes.push({
              name: variableName,
              shape: newShape,
              range: [node.position.end],
            });
          }
        } else if (variableName) {
          // Direct assignment: {% hash_assign a = value %} (works like assign)
          // Close any previous shape for this variable (reassignment)
          closeShapeRange(variableName, node.position.end);

          if (valueShape) {
            shapes.push({
              name: variableName,
              shape: valueShape,
              range: [node.position.end],
            });
          }
        }
      }
    },
  });

  return shapes;
}

export function findLastApplicableShapeIndex(
  variableName: string,
  position: number,
  shapes: VariableShapeEntry[],
): number {
  let lastIdx = -1;

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (shape.name !== variableName) continue;
    const [start, end] = shape.range;
    if (position <= start) continue;
    if (end && position > end) continue;
    lastIdx = i;
  }

  return lastIdx;
}

export function buildLookupPath(
  lookups: LiquidExpression[],
  cursor?: string,
): string[] | undefined {
  const path: string[] = [];

  for (const lookup of lookups) {
    if (lookup.type === NodeTypes.String) {
      path.push(cursor ? lookup.value.replace(cursor, '') : lookup.value);
    } else if (lookup.type === NodeTypes.Number) {
      path.push(String(lookup.value));
    } else {
      return undefined;
    }
  }

  return path;
}

/**
 * Extract the lookup path from a hash_assign target.
 * For {% hash_assign a['key1']['key2'] = value %}, returns ['key1', 'key2']
 */
function getHashAssignLookupPath(markup: HashAssignMarkup): string[] | undefined {
  const path: string[] = [];

  for (const lookup of markup.target.lookups) {
    if (lookup.type === NodeTypes.String) {
      path.push(lookup.value);
    } else if (lookup.type === NodeTypes.Number) {
      path.push(String(lookup.value));
    } else {
      // Dynamic lookup - can't determine statically
      return undefined;
    }
  }

  return path.length > 0 ? path : undefined;
}

/**
 * Merge a nested property into a shape following a path.
 * For path ['a', 'b'] and valueShape, creates/updates shape.a.b = valueShape
 */
function mergeNestedPropertyIntoShape(
  shape: PropertyShape,
  path: string[],
  valueShape: PropertyShape,
): PropertyShape {
  if (path.length === 0) {
    return valueShape;
  }

  const [key, ...rest] = path;

  if (shape.kind !== 'object') {
    // Convert to object
    const properties = new Map<string, PropertyShape>();
    if (rest.length === 0) {
      properties.set(key, valueShape);
    } else {
      properties.set(
        key,
        mergeNestedPropertyIntoShape({ kind: 'object', properties: new Map() }, rest, valueShape),
      );
    }
    return { kind: 'object', properties };
  }

  const newProperties = new Map(shape.properties);
  if (rest.length === 0) {
    newProperties.set(key, valueShape);
  } else {
    const existingNested = newProperties.get(key) || { kind: 'object', properties: new Map() };
    newProperties.set(key, mergeNestedPropertyIntoShape(existingNested, rest, valueShape));
  }
  return { kind: 'object', properties: newProperties };
}

// Type guards
function isLiquidTagAssign(
  node: LiquidTag,
): node is LiquidTag & { markup: { name: string; value: { filters: any[]; expression: any } } } {
  return node.name === NamedTags.assign && typeof node.markup !== 'string';
}

function isLiquidTagParseJson(
  node: LiquidTag,
): node is LiquidTag & { markup: LiquidVariableLookup; children: LiquidHtmlNode[] } {
  return node.name === NamedTags.parse_json && typeof node.markup !== 'string';
}

function isLiquidTagGraphQL(
  node: LiquidTag,
): node is LiquidTag & { markup: GraphQLMarkup | GraphQLInlineMarkup } {
  return node.name === NamedTags.graphql && typeof node.markup !== 'string';
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}

function isGraphQLInlineMarkup(
  markup: GraphQLMarkup | GraphQLInlineMarkup,
): markup is GraphQLInlineMarkup {
  return markup.type === NodeTypes.GraphQLInlineMarkup;
}

function isGraphQLFileMarkup(markup: GraphQLMarkup | GraphQLInlineMarkup): markup is GraphQLMarkup {
  return markup.type === NodeTypes.GraphQLMarkup;
}

function isLiquidString(node: LiquidString | LiquidVariableLookup): node is LiquidString {
  return node.type === NodeTypes.String;
}
