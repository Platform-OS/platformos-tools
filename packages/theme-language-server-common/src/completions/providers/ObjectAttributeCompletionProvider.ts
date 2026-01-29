import {
  NodeTypes,
  LiquidHtmlNode,
  LiquidTag,
  LiquidExpression,
  LiquidVariableLookup,
  LiquidVariable,
  NamedTags,
  TextNode,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  LiquidString,
  HashAssignMarkup,
} from '@platformos/liquid-html-parser';
import { ObjectEntry, ThemeDocset, visit, SourceCodeType } from '@platformos/theme-check-common';
import { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { TypeSystem, isArrayType } from '../../TypeSystem';
import { FindThemeRootURI } from '../../internal-types';
import { CURSOR, LiquidCompletionParams } from '../params';
import { Provider, createCompletionItem, sortByName } from './common';
import {
  PropertyShape,
  inferShapeFromJSONString,
  inferShapeFromGraphQL,
  lookupPropertyPath,
  getAvailableProperties,
  mergePropertyIntoShape,
} from '../../PropertyShapeInference';

const ArrayCoreProperties = ['size', 'first', 'last'] as const;
const StringCoreProperties = ['size'] as const;

interface VariableShapeEntry {
  name: string;
  shape: PropertyShape;
  range: [start: number, end?: number];
}

export class ObjectAttributeCompletionProvider implements Provider {
  private graphqlSchemaCache: string | undefined;
  private graphqlSchemaLoaded = false;

  constructor(
    private readonly typeSystem: TypeSystem,
    private readonly fs?: AbstractFileSystem,
    private readonly documentsLocator?: DocumentsLocator,
    private readonly findThemeRootURI?: FindThemeRootURI,
    private readonly themeDocset?: ThemeDocset,
  ) {}

  private async getGraphQLSchema(): Promise<string | undefined> {
    if (!this.graphqlSchemaLoaded) {
      this.graphqlSchemaCache = (await this.themeDocset?.graphQL()) ?? undefined;
      this.graphqlSchemaLoaded = true;
    }
    return this.graphqlSchemaCache;
  }

  async completions(params: LiquidCompletionParams): Promise<CompletionItem[]> {
    if (!params.completionContext) return [];

    const { partialAst, node } = params.completionContext;
    if (!node || node.type !== NodeTypes.VariableLookup) {
      return [];
    }

    if (node.lookups.length === 0) {
      // We only do lookups in this one
      return [];
    }

    const lastLookup = node.lookups.at(-1)!;
    if (lastLookup.type !== NodeTypes.String) {
      // We don't complete numbers, or variable lookups
      return [];
    }

    const partial = lastLookup.value.replace(CURSOR, '');

    // Fake a VariableLookup up to the last one.
    const parentLookup = { ...node };
    parentLookup.lookups = [...parentLookup.lookups];
    parentLookup.lookups.pop();
    const parentType = await this.typeSystem.inferType(
      parentLookup,
      partialAst,
      params.textDocument.uri,
    );
    if (isArrayType(parentType)) {
      return completionItems(
        ArrayCoreProperties.map((name) => ({ name })),
        partial,
      );
    } else if (parentType === 'string') {
      return completionItems(
        StringCoreProperties.map((name) => ({ name })),
        partial,
      );
    }

    const objectMap = await this.typeSystem.objectMap(params.textDocument.uri, partialAst);
    const parentTypeProperties = objectMap[parentType]?.properties || [];

    // If we have docset properties, use those
    if (parentTypeProperties.length > 0) {
      return completionItems(parentTypeProperties, partial);
    }

    // Otherwise, try shape-based completions for JSON/GraphQL variables
    if (node.name) {
      const rootUri = this.findThemeRootURI
        ? (await this.findThemeRootURI(params.textDocument.uri)) ?? undefined
        : undefined;
      const graphqlSchema = await this.getGraphQLSchema();
      const variableShapes = await extractVariableShapes(
        partialAst,
        this.fs,
        this.documentsLocator,
        rootUri,
        graphqlSchema,
      );
      const lookupPath = buildLookupPath(parentLookup.lookups);

      if (lookupPath) {
        const shapeCompletions = getShapeCompletions(
          node.name,
          lookupPath,
          node.position.start,
          variableShapes,
        );

        if (shapeCompletions.length > 0) {
          return shapeCompletions
            .filter((name) => name.startsWith(partial))
            .sort()
            .map((name) => createCompletionItem({ name }, { kind: CompletionItemKind.Property }));
        }
      }
    }

    return completionItems(parentTypeProperties, partial);
  }
}

function completionItems(options: ObjectEntry[], partial: string) {
  return options
    .filter(({ name }) => name.startsWith(partial))
    .sort(sortByName)
    .map(toPropertyCompletionItem);
}

function toPropertyCompletionItem(object: ObjectEntry) {
  return createCompletionItem(object, { kind: CompletionItemKind.Variable });
}

/**
 * Extract variable shapes from JSON literals, parse_json, and graphql tags in the AST
 */
async function extractVariableShapes(
  ast: LiquidHtmlNode,
  fs?: AbstractFileSystem,
  documentsLocator?: DocumentsLocator,
  rootUri?: string,
  graphqlSchema?: string,
): Promise<VariableShapeEntry[]> {
  const shapes: VariableShapeEntry[] = [];

  await visit<SourceCodeType.LiquidHtml, void>(ast, {
    async LiquidTag(node: LiquidTag) {
      // {% assign x = '[{"a": 3}]' | parse_json %}
      if (isLiquidTagAssign(node)) {
        const markup = node.markup;
        if (markup.value.expression.type === NodeTypes.String) {
          // Check if there's a parse_json or to_hash filter
          const hasParseJsonFilter =
            markup.value.filters &&
            markup.value.filters.some(
              (f: { name: string }) => f.name === 'parse_json' || f.name === 'to_hash',
            );

          if (hasParseJsonFilter) {
            const shape = inferShapeFromJSONString(markup.value.expression.value);
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

      // {% hash_assign x["key"] = value %}
      if (isLiquidTagHashAssign(node)) {
        const markup = node.markup;
        const key = getHashAssignKey(markup);

        if (key) {
          const existingIdx = findLastApplicableShapeIndex(
            markup.name,
            node.position.start,
            shapes,
          );

          if (existingIdx !== -1) {
            const existing = shapes[existingIdx];
            const newShape = mergePropertyIntoShape(existing.shape, key, { kind: 'primitive' });
            shapes.push({
              name: markup.name,
              shape: newShape,
              range: [node.position.end],
            });
          } else {
            const properties = new Map<string, PropertyShape>();
            properties.set(key, { kind: 'primitive' });
            shapes.push({
              name: markup.name,
              shape: { kind: 'object', properties },
              range: [node.position.end],
            });
          }
        }
      }
    },
  });

  return shapes;
}

function getShapeCompletions(
  variableName: string,
  lookupPath: string[],
  position: number,
  shapes: VariableShapeEntry[],
): string[] {
  const shapeIdx = findLastApplicableShapeIndex(variableName, position, shapes);
  if (shapeIdx === -1) {
    return [];
  }

  const shape = shapes[shapeIdx].shape;

  if (lookupPath.length === 0) {
    return getAvailableProperties(shape);
  }

  const result = lookupPropertyPath(shape, lookupPath);
  if (result.shape) {
    return getAvailableProperties(result.shape);
  }

  return [];
}

function findLastApplicableShapeIndex(
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

function buildLookupPath(lookups: LiquidExpression[]): string[] | undefined {
  const path: string[] = [];

  for (const lookup of lookups) {
    if (lookup.type === NodeTypes.String) {
      path.push(lookup.value.replace(CURSOR, ''));
    } else if (lookup.type === NodeTypes.Number) {
      path.push(String(lookup.value));
    } else {
      return undefined;
    }
  }

  return path;
}

function getHashAssignKey(markup: HashAssignMarkup): string | undefined {
  if (markup.source) {
    const match = markup.source.match(/\["([^"]+)"\]|\['([^']+)'\]/);
    if (match) {
      return match[1] || match[2];
    }
  }
  return undefined;
}

// Type guards
function isLiquidTagAssign(
  node: LiquidTag,
): node is LiquidTag & { markup: { name: string; value: LiquidVariable } } {
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
