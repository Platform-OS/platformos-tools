import {
  LiquidHtmlNode,
  LiquidTag,
  LiquidVariableLookup,
  LiquidExpression,
  LiquidString,
  NodeTypes,
  NamedTags,
  TextNode,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  HashAssignMarkup,
} from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isError } from '../../utils';
import {
  PropertyShape,
  inferShapeFromJSONString,
  inferShapeFromGraphQL,
  lookupPropertyPath,
} from './property-shape';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

interface VariableShape {
  name: string;
  shape: PropertyShape;
  range: [start: number, end?: number];
}

export const UnknownProperty: LiquidCheckDefinition = {
  meta: {
    code: 'UnknownProperty',
    name: 'Unknown property access',
    docs: {
      description:
        'Reports errors when accessing properties that do not exist on variables with known structure.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const ast = context.file.ast;
    if (isError(ast)) return {};

    const locator = new DocumentsLocator(context.fs);
    const rootUri = URI.parse(context.config.rootUri);

    // Cache for GraphQL schema
    let graphqlSchema: string | undefined;
    const getGraphQLSchema = async (): Promise<string | undefined> => {
      if (graphqlSchema === undefined) {
        graphqlSchema = (await context.themeDocset?.graphQL()) ?? undefined;
      }
      return graphqlSchema;
    };

    // Track variables with known shapes
    const variableShapes: VariableShape[] = [];

    // Collect variable lookups to validate
    const lookups: LiquidVariableLookup[] = [];

    return {
      async LiquidTag(node: LiquidTag) {
        // {% assign x = '{"a": 5}' %}
        if (isLiquidTagAssign(node)) {
          const markup = node.markup;
          if (markup.value.expression.type === NodeTypes.String) {
            const shape = inferShapeFromJSONString(markup.value.expression.value);
            if (shape) {
              variableShapes.push({
                name: markup.name,
                shape,
                range: [node.position.end],
              });
            }
          }
        }

        // {% parse_json x %}{"a": 5}{% endparse_json %}
        if (isLiquidTagParseJson(node)) {
          const variableName = node.markup.name;
          if (variableName && node.children) {
            const textContent = node.children
              .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
              .map((c) => c.value)
              .join('');
            const shape = inferShapeFromJSONString(textContent);
            if (shape) {
              variableShapes.push({
                name: variableName,
                shape,
                range: [node.blockEndPosition?.end ?? node.position.end],
              });
            }
          }
        }

        // {% graphql result = 'query_name' %} (file-based)
        if (isLiquidTagGraphQL(node) && isGraphQLMarkup(node.markup)) {
          const markup = node.markup;
          const graphqlFile = isLiquidString(markup.graphql) ? markup.graphql.value : null;

          if (graphqlFile) {
            const located = await locator.locate(rootUri, 'graphql', graphqlFile);
            if (located) {
              try {
                const content = await context.fs.readFile(located);
                const schema = await getGraphQLSchema();
                const shape = inferShapeFromGraphQL(content, schema);
                if (shape) {
                  variableShapes.push({
                    name: markup.name,
                    shape,
                    range: [node.position.end],
                  });
                }
              } catch {
                // File read error - skip
              }
            }
          }
        }

        // {% graphql result %}...inline graphql...{% endgraphql %} (inline)
        if (isLiquidTagGraphQL(node) && isGraphQLInlineMarkup(node.markup)) {
          const markup = node.markup;
          if (node.children) {
            const textContent = node.children
              .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
              .map((c) => c.value)
              .join('');
            const schema = await getGraphQLSchema();
            const shape = inferShapeFromGraphQL(textContent, schema);
            if (shape) {
              variableShapes.push({
                name: markup.name,
                shape,
                range: [node.blockEndPosition?.end ?? node.position.end],
              });
            }
          }
        }

        // {% hash_assign x["key"] = value %} or {% hash_assign x["a"]["b"] = value %}
        if (isLiquidTagHashAssign(node)) {
          const markup = node.markup;
          const variableName = markup.target.name;
          const lookupPath = getHashAssignLookupPath(markup);

          if (variableName && lookupPath && lookupPath.length > 0) {
            // Determine value shape - check if value is a JSON string with parse_json filter
            let valueShape: PropertyShape = { kind: 'primitive' };
            if (markup.value.expression.type === NodeTypes.String) {
              const hasParseJsonFilter = markup.value.filters.some(
                (f) => f.name === 'parse_json' || f.name === 'to_hash',
              );
              if (hasParseJsonFilter) {
                const inferredShape = inferShapeFromJSONString(markup.value.expression.value);
                if (inferredShape) {
                  valueShape = inferredShape;
                }
              }
            }

            // Find existing shape for this variable
            const existingIdx = findLastApplicableShapeIndex(
              variableName,
              node.position.start,
              variableShapes,
            );

            if (existingIdx !== -1) {
              // Merge the new property into existing shape
              const existing = variableShapes[existingIdx];
              const newShape = mergeNestedPropertyIntoShape(existing.shape, lookupPath, valueShape);
              variableShapes.push({
                name: variableName,
                shape: newShape,
                range: [node.position.end],
              });
            } else {
              // Create new object shape with this property
              const newShape = mergeNestedPropertyIntoShape(
                { kind: 'object', properties: new Map() },
                lookupPath,
                valueShape,
              );
              variableShapes.push({
                name: variableName,
                shape: newShape,
                range: [node.position.end],
              });
            }
          }
        }
      },

      async VariableLookup(node: LiquidVariableLookup) {
        if (node.lookups.length > 0) {
          lookups.push(node);
        }
      },

      async onCodePathEnd() {
        for (const lookup of lookups) {
          if (!lookup.name) continue;

          // Find the applicable shape for this variable at this position
          const shapeIdx = findLastApplicableShapeIndex(
            lookup.name,
            lookup.position.start,
            variableShapes,
          );

          if (shapeIdx === -1) {
            // No known shape - don't validate (could be dynamic/external)
            continue;
          }

          const applicableShape = variableShapes[shapeIdx];

          // Build the lookup path
          const path = buildLookupPath(lookup.lookups);
          if (!path) {
            // Path contains dynamic access - can't validate
            continue;
          }

          // Check if the path is valid
          const result = lookupPropertyPath(applicableShape.shape, path);

          if (result.error === 'unknown_property' && result.errorAt !== undefined) {
            const invalidProperty = path[result.errorAt];
            const accessPath =
              result.errorAt > 0
                ? `${lookup.name}.${path.slice(0, result.errorAt).join('.')}`
                : lookup.name;

            // Find position of the invalid lookup
            const invalidLookup = lookup.lookups[result.errorAt];

            context.report({
              message: `Unknown property '${invalidProperty}' on '${accessPath}'.`,
              startIndex: invalidLookup.position.start,
              endIndex: invalidLookup.position.end,
            });
          } else if (result.error === 'primitive_access' && result.errorAt !== undefined) {
            const accessPath =
              result.errorAt > 0
                ? `${lookup.name}.${path.slice(0, result.errorAt).join('.')}`
                : lookup.name;

            const invalidLookup = lookup.lookups[result.errorAt];

            context.report({
              message: `Cannot access property '${path[result.errorAt]}' on primitive value '${accessPath}'.`,
              startIndex: invalidLookup.position.start,
              endIndex: invalidLookup.position.end,
            });
          }
        }
      },
    };
  },
};

function findLastApplicableShapeIndex(
  variableName: string,
  position: number,
  shapes: VariableShape[],
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

function buildLookupPath(lookups: LiquidExpression[]): string[] | undefined {
  const path: string[] = [];

  for (const lookup of lookups) {
    if (lookup.type === NodeTypes.String) {
      path.push(lookup.value);
    } else if (lookup.type === NodeTypes.Number) {
      path.push(String(lookup.value));
    } else {
      // Dynamic lookup (variable) - can't validate
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
      properties.set(key, mergeNestedPropertyIntoShape({ kind: 'object', properties: new Map() }, rest, valueShape));
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
): node is LiquidTag & { markup: { name: string; value: { expression: LiquidExpression } } } {
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

function isGraphQLMarkup(markup: GraphQLMarkup | GraphQLInlineMarkup): markup is GraphQLMarkup {
  return markup.type === NodeTypes.GraphQLMarkup;
}

function isGraphQLInlineMarkup(
  markup: GraphQLMarkup | GraphQLInlineMarkup,
): markup is GraphQLInlineMarkup {
  return markup.type === NodeTypes.GraphQLInlineMarkup;
}

function isLiquidString(expr: LiquidString | LiquidVariableLookup): expr is LiquidString {
  return expr.type === NodeTypes.String;
}
