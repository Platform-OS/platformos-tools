import {
  AssignMarkup,
  ComplexLiquidExpression,
  FunctionMarkup,
  LiquidDocParamNode,
  LiquidExpression,
  LiquidHtmlNode,
  LiquidTag,
  LiquidTagDecrement,
  LiquidTagIncrement,
  LiquidVariable,
  LiquidVariableLookup,
  NamedTags,
  NodeTypes,
  TextNode,
  GraphQLMarkup,
  GraphQLInlineMarkup,
  LiquidString,
  HashAssignMarkup,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import {
  ArrayReturnType,
  DocsetEntry,
  FilterEntry,
  MetafieldDefinitionMap,
  MetafieldDefinition,
  ObjectEntry,
  ReturnType,
  SourceCodeType,
  ThemeDocset,
  isError,
  parseJSON,
  path,
  FETCHED_METAFIELD_CATEGORIES,
  BasicParamTypes,
  getValidParamTypes,
  parseParamType,
} from '@platformos/platformos-check-common';
import {
  GetThemeSettingsSchemaForURI,
  InputSetting,
  isInputSetting,
  isSettingsCategory,
} from './settings';
import { findLast, memo } from './utils';
import { visit } from '@platformos/platformos-check-common';
import {
  PropertyShape,
  inferShapeFromJSONString,
  inferShapeFromGraphQL,
  lookupPropertyPath,
  shapeToTypeString,
  shapeToDetailString,
} from './PropertyShapeInference';
import { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

export class TypeSystem {
  private graphqlSchemaCache: string | undefined;
  private graphqlSchemaLoaded = false;

  constructor(
    private readonly themeDocset: ThemeDocset,
    private readonly getThemeSettingsSchemaForURI: GetThemeSettingsSchemaForURI,
    private readonly getMetafieldDefinitions: (rootUri: string) => Promise<MetafieldDefinitionMap>,
    private readonly fs?: AbstractFileSystem,
    private readonly documentsLocator?: DocumentsLocator,
    private readonly findThemeRootURI?: (uri: string) => Promise<string | null>,
  ) {}

  private async getGraphQLSchema(): Promise<string | undefined> {
    if (!this.graphqlSchemaLoaded) {
      this.graphqlSchemaCache = (await this.themeDocset.graphQL()) ?? undefined;
      this.graphqlSchemaLoaded = true;
    }
    return this.graphqlSchemaCache;
  }

  async inferType(
    thing: Identifier | ComplexLiquidExpression | LiquidVariable | AssignMarkup,
    partialAst: LiquidHtmlNode,
    uri: string,
  ): Promise<PseudoType | ArrayType | ShapeType | UnionType> {
    const [objectMap, filtersMap, symbolsTable] = await Promise.all([
      this.objectMap(uri, partialAst),
      this.filtersMap(),
      this.symbolsTable(partialAst, uri),
    ]);

    return inferType(thing, symbolsTable, objectMap, filtersMap);
  }

  async availableVariables(
    partialAst: LiquidHtmlNode,
    partial: string,
    node: LiquidVariableLookup,
    uri: string,
  ): Promise<{ entry: DocsetEntry; type: PseudoType | ArrayType | ShapeType | UnionType }[]> {
    const [objectMap, filtersMap, symbolsTable] = await Promise.all([
      this.objectMap(uri, partialAst),
      this.filtersMap(),
      this.symbolsTable(partialAst, uri),
    ]);

    return Object.entries(symbolsTable)
      .filter(
        ([key, typeRanges]) =>
          key.startsWith(partial) &&
          typeRanges.some((typeRange) => isCorrectTypeRange(typeRange, node)),
      )
      .map(([identifier, typeRanges]) => {
        const typeRange = findLast(typeRanges, (typeRange) => isCorrectTypeRange(typeRange, node))!;
        const type = resolveTypeRangeType(typeRange.type, symbolsTable, objectMap, filtersMap);
        const entryType = isArrayType(type)
          ? type.valueType
          : isShapeType(type) || isUnionType(type)
            ? Untyped
            : type;
        const entry = objectMap[entryType] ?? {};
        return {
          entry: { ...entry, name: identifier },
          type,
        };
      });
  }

  public async themeSettingProperties(uri: string): Promise<ObjectEntry[]> {
    const themeSettingsSchema = await this.getThemeSettingsSchemaForURI(uri);
    const categories = themeSettingsSchema.filter(isSettingsCategory);
    const result: ObjectEntry[] = [];
    for (const category of categories) {
      const inputSettings = category.settings.filter(isInputSetting);
      for (const setting of inputSettings) {
        result.push({
          name: setting.id,
          summary: '', // TODO, this should lookup the locale file for settings... setting.label
          description: '', // TODO , this should lookup the locale file as well... setting.info,
          return_type: settingReturnType(setting),
          access: {
            global: false,
            parents: [],
            template: [],
          },
        });
      }
    }
    return result;
  }

  /**
   * An indexed representation of objects.json by name
   *
   * e.g. objectMap['product'] returns the product ObjectEntry.
   */
  public objectMap = async (uri: string, ast: LiquidHtmlNode): Promise<ObjectMap> => {
    const [objectMap, themeSettingProperties, metafieldDefinitionsObjectMap] = await Promise.all([
      this._objectMap(),
      this.themeSettingProperties(uri),
      this.metafieldDefinitionsObjectMap(uri),
    ]);

    // Here we shallow mutate `settings.properties` to have the properties made
    // available by settings_schema.json
    const result: ObjectMap = {
      ...objectMap,
      settings: {
        ...(objectMap.settings ?? {}),
        properties: themeSettingProperties,
      },
      ...customMetafieldTypeEntries(objectMap['metafield']),
      ...metafieldDefinitionsObjectMap,
    };

    // For each metafield definition fetched, we need to override existing types with `metafields` property
    // to `${category}_metafield`.
    //
    // WARNING: Since we aren't cloning the object, we are mutating the original type for all themes in
    // the workspace. However, this is fine since these changes are not unique to a theme.
    for (let category of FETCHED_METAFIELD_CATEGORIES) {
      if (!result[category]) continue;

      let metafieldsProperty = result[category].properties?.find(
        (prop) => prop.name === 'metafields',
      );

      if (!metafieldsProperty) continue;

      metafieldsProperty.return_type = [{ type: `${category}_metafields`, name: '' }];
    }

    // Deal with sections/file.liquid section.settings by infering the type from the {% schema %}
    if (/[\/\\]sections[\/\\]/.test(uri) && result.section) {
      result.section = JSON.parse(JSON.stringify(result.section)); // easy deep clone
      const settings = result.section.properties?.find((x) => x.name === 'settings');
      if (!settings || !settings.return_type) return result;
      settings.return_type = [{ type: 'section_settings', name: '' }];
      result.section_settings = {
        name: 'section_settings',
        access: {
          global: false,
          parents: [],
          template: [],
        },
        properties: schemaSettingsAsProperties(ast),
        return_type: [],
      };
    }

    // Deal with blocks/files.liquid block.settings in a similar fashion
    if (/[\/\\]blocks[\/\\]/.test(uri) && result.block) {
      result.block = JSON.parse(JSON.stringify(result.block)); // easy deep clone
      const settings = result.block.properties?.find((x) => x.name === 'settings');
      if (!settings || !settings.return_type) return result;
      settings.return_type = [{ type: 'block_settings', name: '' }];
      result.block_settings = {
        name: 'block_settings',
        access: {
          global: false,
          parents: [],
          template: [],
        },
        properties: schemaSettingsAsProperties(ast),
        return_type: [],
      };
    }

    return result;
  };

  public async metafieldDefinitionsObjectMap(uri: string): Promise<ObjectMap> {
    let result: ObjectMap = {};

    const metafieldDefinitionMap = await this.getMetafieldDefinitions(uri);

    for (let [category, definitions] of Object.entries(metafieldDefinitionMap)) {
      // Metafield definitions need to be grouped by their namespace
      let metafieldNamespaces = new Map<string, ObjectEntry[]>();

      for (let definition of definitions as MetafieldDefinition[]) {
        if (!metafieldNamespaces.has(definition.namespace)) {
          metafieldNamespaces.set(definition.namespace, []);
        }

        metafieldNamespaces.get(definition.namespace)!.push({
          name: definition.key,
          description: definition.description,
          return_type: metafieldReturnType(definition.type.name),
        });
      }

      let metafieldGroupProperties: ObjectEntry[] = [];

      for (let [namespace, namespaceProperties] of metafieldNamespaces) {
        const metafieldCategoryNamespaceHandle = `${category}_metafield_${namespace}`;

        // Since the namespace can be shared by multiple categories, we need to make sure the return_type
        // handle is unique across all categories
        metafieldGroupProperties.push({
          name: namespace,
          return_type: [{ type: metafieldCategoryNamespaceHandle, name: '' }],
          access: {
            global: false,
            parents: [],
            template: [],
          },
        });

        result[metafieldCategoryNamespaceHandle] = {
          name: metafieldCategoryNamespaceHandle,
          properties: namespaceProperties,
          access: {
            global: false,
            parents: [],
            template: [],
          },
        };
      }

      const metafieldCategoryHandle = `${category}_metafields`;

      result[metafieldCategoryHandle] = {
        name: metafieldCategoryHandle,
        properties: metafieldGroupProperties,
        access: {
          global: false,
          parents: [],
          template: [],
        },
      };
    }

    return result;
  }

  // This is the big one we reuse (memoized)
  private _objectMap = memo(async (): Promise<ObjectMap> => {
    const entries = await this.objectEntries();
    return entries.reduce((map, entry) => {
      map[entry.name] = entry;
      return map;
    }, {} as ObjectMap);
  });

  /** An indexed representation of filters.json by name */
  public filtersMap = memo(async (): Promise<FiltersMap> => {
    const entries = await this.filterEntries();
    return entries.reduce((map, entry) => {
      map[entry.name] = entry;
      return map;
    }, {} as FiltersMap);
  });

  public filterEntries = memo(async () => {
    return this.themeDocset.filters();
  });

  public objectEntries = memo(async () => {
    return this.themeDocset.objects();
  });

  private async symbolsTable(partialAst: LiquidHtmlNode, uri: string): Promise<SymbolsTable> {
    const [seedSymbolsTable, liquidDrops, graphqlSchema, rootUri, objectMap, filtersMap] =
      await Promise.all([
        this.seedSymbolsTable(uri),
        this.themeDocset.liquidDrops(),
        this.getGraphQLSchema(),
        this.findThemeRootURI?.(uri) ?? null,
        this.objectMap(uri, partialAst),
        this.filtersMap(),
      ]);
    return await buildSymbolsTable(
      partialAst,
      seedSymbolsTable,
      liquidDrops,
      graphqlSchema,
      this.fs,
      this.documentsLocator,
      rootUri ?? undefined,
      undefined, // processingFiles
      objectMap,
      filtersMap,
    );
  }

  /**
   * The seedSymbolsTable contains all the global variables.
   *
   * This lets us have the ambient type of things first, but if someone
   * reassigns product, then we'll be able to change the type of product on
   * the appropriate range.
   *
   * This is not memo'ed because we would otherwise need to clone the thing.
   */
  private seedSymbolsTable = async (uri: string) => {
    const [globalVariables, contextualVariables] = await Promise.all([
      this.globalVariables(),
      this.contextualVariables(uri),
    ]);
    return globalVariables.concat(contextualVariables).reduce((table, objectEntry) => {
      table[objectEntry.name] ??= [];
      table[objectEntry.name].push({
        identifier: objectEntry.name,
        type: objectEntryType(objectEntry),
        range: [0],
      });
      return table;
    }, {} as SymbolsTable);
  };

  private globalVariables = memo(async () => {
    const entries = await this.objectEntries();
    return entries.filter(
      (entry) => !entry.access || entry.access.global === true || entry.access.template.length > 0,
    );
  });

  private contextualVariables = async (uri: string) => {
    const entries = await this.objectEntries();
    const contextualEntries = getContextualEntries(uri);
    return entries.filter((entry) => contextualEntries.includes(entry.name));
  };
}

const SECTION_FILE_REGEX = /sections[\/\\][^.\\\/]*\.liquid$/;
const BLOCK_FILE_REGEX = /blocks[\/\\][^.\\\/]*\.liquid$/;
const SNIPPET_FILE_REGEX = /snippets[\/\\][^.\\\/]*\.liquid$/;
const LAYOUT_FILE_REGEX = /layout[\/\\]checkout\.liquid$/;

function getContextualEntries(uri: string): string[] {
  const normalizedUri = path.normalize(uri);
  if (LAYOUT_FILE_REGEX.test(normalizedUri)) {
    return [
      'locale',
      'direction',
      'skip_to_content_link',
      'checkout_html_classes',
      'checkout_stylesheets',
      'checkout_scripts',
      'content_for_logo',
      'breadcrumb',
      'order_summary_toggle',
      'content_for_order_summary',
      'alternative_payment_methods',
      'content_for_footer',
      'tracking_code',
    ];
  }
  if (SECTION_FILE_REGEX.test(normalizedUri)) {
    return ['section', 'predictive_search', 'recommendations', 'comment'];
  }
  if (BLOCK_FILE_REGEX.test(normalizedUri)) {
    return ['app', 'section', 'recommendations', 'block'];
  }
  if (SNIPPET_FILE_REGEX.test(normalizedUri)) {
    return ['app'];
  }
  return [];
}

/** An indexed representation on objects.json (by name) */
type ObjectMap = Record<ObjectEntryName, ObjectEntry>;

/** An indexed representation on filters.json (by name) */
type FiltersMap = Record<FilterEntryName, FilterEntry>;

/** An identifier refers to the name of a variable, e.g. `x`, `product`, etc. */
type Identifier = string;

type ObjectEntryName = ObjectEntry['name'];
type FilterEntryName = FilterEntry['name'];

/** Untyped is for declared variables without a type (like `any`) */
export const Untyped = 'untyped' as const;
export type Untyped = typeof Untyped;

/** Unknown is for variables that don't exist, type would come from context (e.g. snippet var without LiquidDoc) */
export const Unknown = 'unknown' as const;
export type Unknown = typeof Untyped;

const String = 'string' as const;
type String = typeof String;

/** A pseudo-type is the possible values of an ObjectEntry's return_type.type */
export type PseudoType = ObjectEntryName | String | Untyped | Unknown | 'number' | 'boolean';

/**
 * A variable can have many types in the same file
 *
 * Just think of this:
 *
 *   {{ x }} # unknown
 *   {% assign x = all_products['cool-handle'] %}
 *   {{ x }} # product
 *   {% assign x = x.featured_image %}
 *   {{ x }} # image
 *   [% assign x = x.src %}]
 *   {{ x }} # string
 */
interface TypeRange {
  /** The name of the variable */
  identifier: Identifier;

  /** The type of the variable */
  type: PseudoType | ArrayType | ShapeType | UnionType | LazyVariableType | LazyDeconstructedExpression;

  /**
   * The range may be one of two things:
   *  - open ended (till end of file, end === undefined)
   *  - closed (inside for loop)
   */
  range: [start: number, end?: number];
}

/** Some things can be an array type (e.g. product.images) */
export type ArrayType = {
  kind: 'array';
  valueType: PseudoType;
};
const arrayType = (valueType: PseudoType): ArrayType => ({
  kind: 'array',
  valueType,
});

/** ShapeType represents inferred types from parse_json, graphql, hash_assign */
export type ShapeType = {
  kind: 'shape';
  shape: PropertyShape;
};
const shapeType = (shape: PropertyShape): ShapeType => ({
  kind: 'shape',
  shape,
});

/** UnionType represents multiple possible types (e.g., from conditional returns) */
export type UnionType = {
  kind: 'union';
  types: (PseudoType | ArrayType | ShapeType)[];
};
const unionType = (types: (PseudoType | ArrayType | ShapeType)[]): UnionType => ({
  kind: 'union',
  types,
});

/**
 * Because a type may depend on another, this represents the type of
 * something as the type of a LiquidVariable chain.
 * {% assign x = y.foo | filter1 | filter2 %}
 */
type LazyVariableType = {
  kind: NodeTypes.LiquidVariable;
  node: LiquidVariable;
  offset: number;
};
const lazyVariable = (node: LiquidVariable, offset: number): LazyVariableType => ({
  kind: NodeTypes.LiquidVariable,
  node,
  offset,
});

/**
 * A thing may be the deconstruction of something else.
 *
 * examples
 * - for thing in (0..2)
 * - for thing in collection
 * - for thing in parent.collection
 * - for thing in 'string?'
 */
type LazyDeconstructedExpression = {
  kind: 'deconstructed';
  node: LiquidExpression;
  offset: number;
};
const LazyDeconstructedExpression = (
  node: LiquidExpression,
  offset: number,
): LazyDeconstructedExpression => ({
  kind: 'deconstructed',
  node,
  offset,
});

/**
 * A symbols table is a map of identifiers to TypeRanges.
 *
 * It stores the mapping of variable name to type by position in the file.
 *
 * The ranges are sorted in range.start order.
 */
type SymbolsTable = Record<Identifier, TypeRange[]>;

async function buildSymbolsTable(
  partialAst: LiquidHtmlNode,
  seedSymbolsTable: SymbolsTable,
  liquidDrops: ObjectEntry[],
  graphqlSchema?: string,
  fs?: AbstractFileSystem,
  documentsLocator?: DocumentsLocator,
  rootUri?: string,
  processingFiles?: Set<string>,
  objectMap?: ObjectMap,
  filtersMap?: FiltersMap,
): Promise<SymbolsTable> {
  // Track shapes for hash_assign merging
  const variableShapes: Map<string, { shape: PropertyShape; rangeEnd: number }[]> = new Map();

  const typeRanges = await visit<SourceCodeType.LiquidHtml, TypeRange | TypeRange[]>(partialAst, {
    // {% assign x = foo.x | filter %}
    // {% assign x = '{"a": 1}' | parse_json %}
    async AssignMarkup(node) {
      // Check if this has a parse_json or to_hash filter
      const hasParseJsonFilter = node.value.filters?.some(
        (f: { name: string }) => f.name === 'parse_json' || f.name === 'to_hash',
      );

      if (hasParseJsonFilter) {
        let jsonString: string | undefined;

        // Check if expression is a direct JSON string
        if (node.value.expression.type === NodeTypes.String) {
          jsonString = node.value.expression.value;
        }

        // Check if there's a default filter with a JSON string argument
        if (!jsonString && node.value.filters) {
          const defaultFilter = node.value.filters.find(
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
            // Track shape for potential hash_assign merging
            if (!variableShapes.has(node.name)) {
              variableShapes.set(node.name, []);
            }
            variableShapes.get(node.name)!.push({ shape, rangeEnd: node.position.end });

            return {
              identifier: node.name,
              type: shapeType(shape),
              range: [node.position.end],
            };
          }
        }
      }

      return {
        identifier: node.name,
        type: lazyVariable(node.value, node.position.start),
        range: [node.position.end],
      };
    },

    // {% doc %}
    //   @param {string} name - your name
    // {% enddoc %}
    async LiquidDocParamNode(node) {
      return {
        identifier: node.paramName.value,
        type: inferLiquidDocParamType(node, liquidDrops),
        range: [node.position.end],
      };
    },

    // This also covers tablerow
    async ForMarkup(node, ancestors) {
      const parentNode = ancestors.at(-1)! as LiquidTag;
      return {
        identifier: node.variableName,
        type: LazyDeconstructedExpression(node.collection, node.position.start),
        range: [parentNode.blockStartPosition.end, end(parentNode.blockEndPosition?.end)],
      };
    },

    // {% capture foo %}
    //   ...
    // {% endcapture}
    async LiquidTag(node) {
      if (node.name === 'capture' && typeof node.markup !== 'string') {
        return {
          identifier: node.markup.name!,
          type: String,
          range: [node.position.end],
        };
      } else if (['form', 'paginate'].includes(node.name)) {
        return {
          identifier: node.name,
          type: node.name,
          range: [node.blockStartPosition.end, end(node.blockEndPosition?.end)],
        };
      } else if (['for', 'tablerow'].includes(node.name)) {
        return {
          identifier: node.name + 'loop',
          type: node.name + 'loop',
          range: [node.blockStartPosition.end, end(node.blockEndPosition?.end)],
        };
      } else if (isLiquidTagIncrement(node) || isLiquidTagDecrement(node)) {
        if (node.markup.name === null) return;
        return {
          identifier: node.markup.name,
          type: 'number',
          range: [node.position.start],
        };
      } else if (node.name === 'layout') {
        return {
          identifier: 'none',
          type: 'keyword',
          range: [node.position.start, node.position.end],
        };
      }
      // {% parse_json x %}{"a": 1}{% endparse_json %}
      else if (isLiquidTagParseJson(node)) {
        const variableName = node.markup.name;
        if (variableName && node.children) {
          const textContent = node.children
            .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
            .map((c) => c.value)
            .join('');
          const shape = inferShapeFromJSONString(textContent);
          if (shape) {
            // Track shape for potential hash_assign merging
            if (!variableShapes.has(variableName)) {
              variableShapes.set(variableName, []);
            }
            variableShapes.get(variableName)!.push({
              shape,
              rangeEnd: node.blockEndPosition?.end ?? node.position.end,
            });

            return {
              identifier: variableName,
              type: shapeType(shape),
              range: [node.blockEndPosition?.end ?? node.position.end],
            };
          }
        }
      }
      // {% graphql result %}...{% endgraphql %} (inline)
      else if (isLiquidTagGraphQL(node) && isGraphQLInlineMarkup(node.markup)) {
        const markup = node.markup;
        if (node.children) {
          const textContent = node.children
            .filter((c): c is TextNode => c.type === NodeTypes.TextNode)
            .map((c) => c.value)
            .join('');
          const shape = inferShapeFromGraphQL(textContent, graphqlSchema);
          if (shape) {
            // Track shape for potential hash_assign merging
            if (!variableShapes.has(markup.name)) {
              variableShapes.set(markup.name, []);
            }
            variableShapes.get(markup.name)!.push({
              shape,
              rangeEnd: node.blockEndPosition?.end ?? node.position.end,
            });

            return {
              identifier: markup.name,
              type: shapeType(shape),
              range: [node.blockEndPosition?.end ?? node.position.end],
            };
          }
        }
      }
      // {% graphql result = 'file' %} (file-based)
      else if (isLiquidTagGraphQL(node) && isGraphQLFileMarkup(node.markup)) {
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
                // Track shape for potential hash_assign merging
                if (!variableShapes.has(markup.name)) {
                  variableShapes.set(markup.name, []);
                }
                variableShapes.get(markup.name)!.push({
                  shape,
                  rangeEnd: node.position.end,
                });

                return {
                  identifier: markup.name,
                  type: shapeType(shape),
                  range: [node.position.end],
                };
              }
            }
          } catch {
            // File read error - skip
          }
        }
      }
      // {% hash_assign x['key'] = value %}
      else if (isLiquidTagHashAssign(node)) {
        const markup = node.markup;
        const variableName = markup.target.name;
        if (!variableName) return;

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

        // Check for existing type - first in variableShapes, then in seedSymbolsTable
        const existingShapes = variableShapes.get(variableName) || [];
        const existingShapeEntry = findLastApplicableShape(existingShapes, node.position.start);

        // Check seedSymbolsTable for existing type if not in variableShapes
        let existingType: PseudoType | ArrayType | ShapeType | UnionType | undefined;
        if (!existingShapeEntry && seedSymbolsTable[variableName]) {
          const typeRanges = seedSymbolsTable[variableName];
          // Find the most recent type before this position
          for (const tr of typeRanges) {
            if (tr.range[0] < node.position.start) {
              // Resolve lazy types
              if (typeof tr.type === 'string') {
                existingType = tr.type;
              } else if (tr.type.kind === 'shape' || tr.type.kind === 'array' || tr.type.kind === 'union') {
                existingType = tr.type;
              }
            }
          }
        }

        // Check if hash_assign is being applied to a non-object type (error case)
        const nonObjectTypes = ['number', 'string', 'boolean'];
        if (!existingShapeEntry && existingType) {
          if (typeof existingType === 'string' && nonObjectTypes.includes(existingType)) {
            // Can't hash_assign to a primitive - this is an error
            // Return undefined to not change the type (let a check rule report the error)
            return;
          }
          if (isArrayType(existingType)) {
            // Can't hash_assign to an array - this is an error
            return;
          }
        }

        if (lookupPath && lookupPath.length > 0) {
          // Nested property assignment: {% hash_assign a['key'] = value %}
          let baseShape: PropertyShape;
          if (existingShapeEntry) {
            baseShape = existingShapeEntry.shape;
          } else if (existingType && isShapeType(existingType)) {
            baseShape = existingType.shape;
          } else {
            baseShape = { kind: 'object', properties: new Map() };
          }

          const newShape = mergeNestedPropertyIntoShape(
            baseShape,
            lookupPath,
            valueShape ?? { kind: 'primitive' },
          );

          // Track the new shape
          if (!variableShapes.has(variableName)) {
            variableShapes.set(variableName, []);
          }
          variableShapes.get(variableName)!.push({ shape: newShape, rangeEnd: node.position.end });

          return {
            identifier: variableName,
            type: shapeType(newShape),
            range: [node.position.end],
          };
        } else if (valueShape) {
          // Direct assignment: {% hash_assign a = value %} (works like assign)
          if (!variableShapes.has(variableName)) {
            variableShapes.set(variableName, []);
          }
          variableShapes.get(variableName)!.push({ shape: valueShape, rangeEnd: node.position.end });

          return {
            identifier: variableName,
            type: shapeType(valueShape),
            range: [node.position.end],
          };
        }
      }
      // {% function result = 'partial/path', args... %}
      else if (isLiquidTagFunction(node)) {
        const markup = node.markup;
        let returnType: PseudoType | ArrayType | ShapeType | UnionType | undefined;
        if (
          fs &&
          documentsLocator &&
          rootUri &&
          objectMap &&
          filtersMap &&
          isLiquidString(markup.partial)
        ) {
          const partialPath = markup.partial.value;
          try {
            returnType = await inferFunctionReturnType(
              partialPath,
              fs,
              documentsLocator,
              rootUri,
              seedSymbolsTable,
              liquidDrops,
              graphqlSchema,
              processingFiles,
              objectMap,
              filtersMap,
            );
          } catch {
            // File read/parse error - returnType stays undefined
          }
        }

        // Track shape for potential hash_assign merging
        if (returnType && isShapeType(returnType)) {
          if (!variableShapes.has(markup.name)) {
            variableShapes.set(markup.name, []);
          }
          variableShapes.get(markup.name)!.push({
            shape: returnType.shape,
            rangeEnd: node.position.end,
          });
        }

        // Always add function variable to symbolsTable, using Untyped as fallback
        return {
          identifier: markup.name,
          type: returnType ?? Untyped,
          range: [node.position.end],
        };
      }
    },
  });

  // Flatten array results (some visitors return TypeRange[])
  const flattenedRanges = typeRanges.flat();

  return flattenedRanges
    .sort(({ range: [startA] }, { range: [startB] }) => startA - startB)
    .reduce((table, typeRange) => {
      table[typeRange.identifier] ??= [];
      table[typeRange.identifier].push(typeRange);
      return table;
    }, seedSymbolsTable);
}

/**
 * Given a TypeRange['type'] (which may be lazy), resolve its type recursively.
 *
 * The output is a fully resolved PseudoType | ArrayType | ShapeType. Which means we
 * could use it to power completions.
 */
function resolveTypeRangeType(
  typeRangeType: TypeRange['type'],
  symbolsTable: SymbolsTable,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): PseudoType | ArrayType | ShapeType | UnionType {
  if (typeof typeRangeType === 'string') {
    return typeRangeType;
  }

  switch (typeRangeType.kind) {
    case 'array': {
      return typeRangeType;
    }

    case 'shape': {
      return typeRangeType;
    }

    case 'union': {
      return typeRangeType;
    }

    case 'deconstructed': {
      const deconstructedType = inferType(typeRangeType.node, symbolsTable, objectMap, filtersMap);
      if (typeof deconstructedType === 'string') {
        return Untyped;
      } else if (isShapeType(deconstructedType)) {
        // Deconstruct shape array
        if (deconstructedType.shape.kind === 'array' && deconstructedType.shape.itemShape) {
          return shapeType(deconstructedType.shape.itemShape);
        }
        return Untyped;
      } else if (isUnionType(deconstructedType)) {
        return Untyped;
      } else {
        return deconstructedType.valueType;
      }
    }

    default: {
      return inferType(typeRangeType.node, symbolsTable, objectMap, filtersMap);
    }
  }
}

function inferType(
  thing: Identifier | ComplexLiquidExpression | LiquidVariable | AssignMarkup,
  symbolsTable: SymbolsTable,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): PseudoType | ArrayType | ShapeType | UnionType {
  if (typeof thing === 'string') {
    return objectMap[thing as PseudoType]?.name ?? Untyped;
  }

  switch (thing.type) {
    case NodeTypes.Number: {
      return 'number';
    }

    case NodeTypes.String: {
      return 'string';
    }

    case NodeTypes.LiquidLiteral: {
      return 'boolean';
    }

    case NodeTypes.BooleanExpression: {
      return 'boolean';
    }

    case NodeTypes.Range: {
      return arrayType('number');
    }

    // The type of the assign markup is the type of the right hand side.
    // {% assign x = y.property | filter1 | filter2 %}
    case NodeTypes.AssignMarkup: {
      return inferType(thing.value, symbolsTable, objectMap, filtersMap);
    }

    // A variable lookup is expression[.lookup]*
    // {{ y.property }}
    case NodeTypes.VariableLookup: {
      return inferLookupType(thing, symbolsTable, objectMap, filtersMap);
    }

    // A variable is the VariableLookup + Filters
    // The type is the return value of the last filter
    // {{ y.property | filter1 | filter2 }}
    case NodeTypes.LiquidVariable: {
      if (thing.filters.length > 0) {
        const lastFilter = thing.filters.at(-1)!;
        if (lastFilter.name === 'default') {
          // default filter is a special case, we need to return the type of the expression
          // instead of the filter.
          if (lastFilter.args.length > 0 && lastFilter.args[0].type !== NodeTypes.NamedArgument) {
            return inferType(lastFilter.args[0], symbolsTable, objectMap, filtersMap);
          }
        }
        const filterEntry = filtersMap[lastFilter.name];
        return filterEntry ? filterEntryReturnType(filterEntry) : Untyped;
      } else {
        return inferType(thing.expression, symbolsTable, objectMap, filtersMap);
      }
    }

    default: {
      return Untyped;
    }
  }
}

function inferLiquidDocParamType(node: LiquidDocParamNode, liquidDrops: ObjectEntry[]) {
  const paramTypeValue = node.paramType?.value;

  if (!paramTypeValue) return Untyped;

  const validParamTypes = getValidParamTypes(liquidDrops);

  const parsedParamType = parseParamType(new Set(validParamTypes.keys()), paramTypeValue);

  if (!parsedParamType) return Untyped;

  const [type, isArray] = parsedParamType;

  let transformedParamType;

  // BasicParamTypes.Object does not map to any specific type in the type system.
  if (type === BasicParamTypes.Object) {
    transformedParamType = Untyped;
  } else {
    transformedParamType = type;
  }

  if (isArray) {
    return arrayType(transformedParamType);
  }

  return transformedParamType;
}

function inferLookupType(
  thing: LiquidVariableLookup,
  symbolsTable: SymbolsTable,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): PseudoType | ArrayType | ShapeType | UnionType {
  // we return the type of the drop, so a.b.c
  const node = thing;

  // We don't complete global lookups. It's too much of an edge case.
  if (node.name === null) return Untyped;

  /**
   * curr stores the type of the variable lookup starting at the beginning.
   *
   * It starts as the type of the top-level identifier, and the we
   * recursively change it to the return type of the lookups.
   *
   * So, for x.images.first.src we do:
   * - curr = infer type of x                   | x
   * - curr = x.images -> ArrayType<image>      | x.images
   * - curr = images.first -> image             | x.images.first
   * - curr = first.src -> string               | x.images.first.src
   *
   * Once were done iterating, the type of the lookup is curr.
   */
  let curr: PseudoType | ArrayType | ShapeType | UnionType = inferIdentifierType(
    node,
    symbolsTable,
    objectMap,
    filtersMap,
  );

  for (let lookup of node.lookups) {
    // Here we redefine curr to be the returnType of the lookup.

    // e.g. images[0] -> image
    // e.g. images.first -> image
    // e.g. images.size -> number
    if (isArrayType(curr)) {
      curr = inferArrayTypeLookupType(curr, lookup);
    }

    // Handle ShapeType from parse_json, graphql, hash_assign
    else if (isShapeType(curr)) {
      curr = inferShapeTypeLookupType(curr, lookup);
    }

    // Handle UnionType - for now, treat as Untyped for lookups
    else if (isUnionType(curr)) {
      return Untyped;
    }

    // e.g. product.featured_image -> image
    // e.g. product.images -> ArrayType<images>
    // e.g. product.name -> string
    else {
      curr = inferPseudoTypePropertyType(curr, lookup, objectMap);
    }

    // Early return
    if (curr === Untyped) {
      return Untyped;
    }
  }

  return curr;
}

/**
 * Given a VariableLookup node, infer the type of its root (position-relative).
 *
 * e.g. for the following
 *   {% assign x = product %}
 *   {{ x.images.first }}
 *
 * This function infers the type of `x`.
 */
function inferIdentifierType(
  node: LiquidVariableLookup,
  symbolsTable: SymbolsTable,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): PseudoType | ArrayType | ShapeType | UnionType {
  // The name of a variable
  const identifier = node.name;

  // We don't complete the global access edge case
  // e.g. {{ ['all_products'] }}
  if (!identifier) {
    return Untyped;
  }

  const typeRanges = symbolsTable[identifier];
  if (!typeRanges) {
    return Unknown;
  }

  const typeRange = findLast(typeRanges, (tr) => isCorrectTypeRange(tr, node));

  return typeRange
    ? resolveTypeRangeType(typeRange.type, symbolsTable, objectMap, filtersMap)
    : Unknown;
}

/**
 * infers the type of a lookup on an ArrayType
 * - images[0] becomes 'image'
 * - images[index] becomes 'image'
 * - images.first becomes 'image'
 * - images.last becomes 'image'
 * - images.size becomes 'number'
 * - anything else becomes 'untyped'
 */
function inferArrayTypeLookupType(curr: ArrayType, lookup: LiquidExpression) {
  // images[0]
  // images[index]
  if (lookup.type === NodeTypes.Number || lookup.type === NodeTypes.VariableLookup) {
    return curr.valueType;
  }
  // images.first
  // images.last
  // images.size
  // anything else is undef
  else if (lookup.type === NodeTypes.String) {
    switch (lookup.value) {
      case 'first':
      case 'last': {
        return curr.valueType;
      }

      case 'size': {
        return 'number';
      }

      default: {
        return Unknown;
      }
    }
  }
  // images[true]
  // images[(0..2)]
  else {
    return Untyped;
  }
}

/**
 * Infers the type of a lookup on a ShapeType (from parse_json, graphql, hash_assign)
 */
function inferShapeTypeLookupType(
  curr: ShapeType,
  lookup: LiquidExpression,
): PseudoType | ArrayType | ShapeType {
  const shape = curr.shape;

  // Handle array shape lookups
  if (shape.kind === 'array') {
    // array[0] or array[variable] -> item type
    if (lookup.type === NodeTypes.Number || lookup.type === NodeTypes.VariableLookup) {
      if (shape.itemShape) {
        return shapeToType(shape.itemShape);
      }
      return Untyped;
    }

    // array.first, array.last, array.size
    if (lookup.type === NodeTypes.String) {
      switch (lookup.value) {
        case 'first':
        case 'last':
          if (shape.itemShape) {
            return shapeToType(shape.itemShape);
          }
          return Untyped;
        case 'size':
          return 'number';
        default:
          return Unknown;
      }
    }

    return Untyped;
  }

  // Handle object shape lookups
  if (shape.kind === 'object') {
    // Object lookups must be strings
    if (lookup.type !== NodeTypes.String) {
      return Untyped;
    }

    const propertyName = lookup.value;
    const propertyShape = shape.properties?.get(propertyName);

    if (propertyShape) {
      return shapeToType(propertyShape);
    }

    return Unknown;
  }

  // Primitive shapes don't support lookups (except string.size, string.first, string.last)
  if (shape.kind === 'primitive') {
    if (shape.primitiveType === 'string' && lookup.type === NodeTypes.String) {
      switch (lookup.value) {
        case 'first':
        case 'last':
          return 'string';
        case 'size':
          return 'number';
        default:
          return Unknown;
      }
    }
    return Unknown;
  }

  return Untyped;
}

/**
 * Convert a PropertyShape to a PseudoType, ArrayType, or ShapeType
 */
function shapeToType(shape: PropertyShape): PseudoType | ArrayType | ShapeType {
  if (shape.kind === 'primitive') {
    switch (shape.primitiveType) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      default:
        return Untyped;
    }
  }

  if (shape.kind === 'array') {
    // If array items are primitives, return ArrayType
    if (shape.itemShape?.kind === 'primitive') {
      const primitiveType = shape.itemShape.primitiveType;
      if (primitiveType === 'string' || primitiveType === 'number' || primitiveType === 'boolean') {
        return arrayType(primitiveType);
      }
    }
    // Otherwise return ShapeType to preserve nested structure
    return shapeType(shape);
  }

  if (shape.kind === 'object') {
    return shapeType(shape);
  }

  return Untyped;
}

function inferPseudoTypePropertyType(
  curr: PseudoType, // settings
  lookup: LiquidExpression,
  objectMap: ObjectMap,
) {
  const parentEntry: ObjectEntry | undefined = objectMap[curr];

  // When doing a non string lookup, we don't really know the type. e.g.
  // products[0]
  // products[true]
  // products[(0..10)]
  if (lookup.type !== NodeTypes.String) {
    return Untyped;
  }

  // When we don't have docs for the parent entry
  if (!parentEntry) {
    // It might be that the parent entry is a string.
    // We do support a couple of properties for those
    if (curr === 'string') {
      switch (lookup.value) {
        // some_string.first
        // some_string.last
        case 'first':
        case 'last':
          return 'string';

        // some_string.size
        case 'size':
          return 'number';

        default: {
          // For the string type, any property access other than first/last/size
          // is unknown. This is different from an untyped/any object where any
          // property access would return untyped.
          // String is a known type with specific properties, so accessing
          // undefined properties returns an unknown.
          return Unknown;
        }
      }
    }

    // Or it might be that the parent entry is untyped, so its subproperty
    // could also be untyped (kind of like if `foo` is `any`, then `foo.bar` is `any`)
    return Untyped;
  }

  const propertyName = lookup.value;
  const property = parentEntry.properties?.find((property) => property.name === propertyName);

  // When the propety is not known, return Untyped. e.g.
  // product.foo
  // product.bar
  if (!property) {
    // Debating between returning Untyped or Unknown here
    // Might be that we have outdated docs. Prob better to return Untyped.
    return Untyped;
  }

  // When the property is known & we have docs for it, return its type. e.g.
  // product.image
  // product.images
  return objectEntryType(property);
}

function filterEntryReturnType(entry: FilterEntry): PseudoType | ArrayType {
  return docsetEntryReturnType(entry, 'string');
}

function objectEntryType(entry: ObjectEntry): PseudoType | ArrayType {
  return docsetEntryReturnType(entry, entry.name);
}

/**
 * This function converts the return_type property in one of the .json
 * files into a PseudoType or ArrayType.
 */
export function docsetEntryReturnType(
  entry: ObjectEntry | FilterEntry,
  defaultValue: PseudoType,
): PseudoType | ArrayType {
  const returnTypes = entry.return_type;
  if (returnTypes && returnTypes.length > 0) {
    const returnType = returnTypes[0];
    if (isArrayReturnType(returnType)) {
      return arrayType(returnType.array_value);
    } else {
      return returnType.type;
    }
  }

  return defaultValue;
}

function isArrayReturnType(rt: ReturnType): rt is ArrayReturnType {
  return rt.type === 'array';
}

export function isArrayType(
  thing: PseudoType | ArrayType | ShapeType | UnionType,
): thing is ArrayType {
  return typeof thing !== 'string' && thing.kind === 'array';
}

export function isShapeType(
  thing: PseudoType | ArrayType | ShapeType | UnionType,
): thing is ShapeType {
  return typeof thing !== 'string' && thing.kind === 'shape';
}

/** Assumes findLast */
function isCorrectTypeRange(typeRange: TypeRange, node: LiquidVariableLookup): boolean {
  const [start, end] = typeRange.range;
  if (end && node.position.start > end) return false;
  return node.position.start > start;
}

function end(offset: number | undefined): number | undefined {
  if (offset === -1) return undefined;
  return offset;
}

function isLiquidTagIncrement(node: LiquidTag): node is LiquidTagIncrement {
  return node.name === NamedTags.increment && typeof node.markup !== 'string';
}

function isLiquidTagDecrement(node: LiquidTag): node is LiquidTagDecrement {
  return node.name === NamedTags.decrement && typeof node.markup !== 'string';
}

function isLiquidTagParseJson(
  node: LiquidTag,
): node is LiquidTag & { markup: { name: string }; children: LiquidHtmlNode[] } {
  return node.name === NamedTags.parse_json && typeof node.markup !== 'string';
}

function isLiquidTagGraphQL(
  node: LiquidTag,
): node is LiquidTag & { markup: GraphQLMarkup | GraphQLInlineMarkup } {
  return node.name === NamedTags.graphql && typeof node.markup !== 'string';
}

function isGraphQLInlineMarkup(
  markup: GraphQLMarkup | GraphQLInlineMarkup,
): markup is GraphQLInlineMarkup {
  return markup.type === NodeTypes.GraphQLInlineMarkup;
}

function isGraphQLFileMarkup(
  markup: GraphQLMarkup | GraphQLInlineMarkup,
): markup is GraphQLMarkup {
  return markup.type === NodeTypes.GraphQLMarkup;
}

function isLiquidString(node: LiquidString | LiquidVariableLookup): node is LiquidString {
  return node.type === NodeTypes.String;
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}

function isLiquidTagFunction(node: LiquidTag): node is LiquidTag & { markup: FunctionMarkup } {
  return node.name === NamedTags.function && typeof node.markup !== 'string';
}

export function isUnionType(
  thing: PseudoType | ArrayType | ShapeType | UnionType,
): thing is UnionType {
  return typeof thing !== 'string' && thing.kind === 'union';
}

/**
 * Infer the return type of a function partial by analyzing its {% return %} statements.
 */
async function inferFunctionReturnType(
  partialPath: string,
  fs: AbstractFileSystem,
  documentsLocator: DocumentsLocator,
  rootUri: string,
  seedSymbolsTable: SymbolsTable,
  liquidDrops: ObjectEntry[],
  graphqlSchema: string | undefined,
  processingFiles: Set<string> | undefined,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): Promise<PseudoType | ArrayType | ShapeType | UnionType | undefined> {
  // 1. Locate the file
  const located = await documentsLocator.locate(URI.parse(rootUri), 'function', partialPath);
  if (!located) return undefined;

  // 2. Check for circular references
  const trackingSet = processingFiles ?? new Set<string>();
  if (trackingSet.has(located)) return Untyped;
  trackingSet.add(located);

  try {
    // 3. Read and parse the partial
    const content = await fs.readFile(located);
    const partialAst = toLiquidHtmlAST(content);

    // 4. Build symbols table for the partial (recursive)
    const partialSymbolsTable = await buildSymbolsTable(
      partialAst,
      { ...seedSymbolsTable }, // Clone to avoid pollution
      liquidDrops,
      graphqlSchema,
      fs,
      documentsLocator,
      rootUri,
      trackingSet,
      objectMap,
      filtersMap,
    );

    // 5. Find all return statements and infer their types
    const returnTypes: (PseudoType | ArrayType | ShapeType)[] = [];

    await visit<SourceCodeType.LiquidHtml, void>(partialAst, {
      async LiquidTag(node) {
        if (node.name === NamedTags.return && typeof node.markup !== 'string') {
          // markup is LiquidVariable - infer its type
          const type = inferType(node.markup, partialSymbolsTable, objectMap, filtersMap);
          // Flatten union types into individual types
          if (isUnionType(type)) {
            returnTypes.push(...type.types);
          } else {
            returnTypes.push(type);
          }
        }
      },
    });

    if (returnTypes.length === 0) return undefined;
    if (returnTypes.length === 1) return returnTypes[0];

    // Dedupe types (same type appearing multiple times)
    const uniqueTypes = dedupeTypes(returnTypes);
    if (uniqueTypes.length === 1) return uniqueTypes[0];

    return unionType(uniqueTypes);
  } finally {
    trackingSet.delete(located);
  }
}

/**
 * Deduplicate types by comparing their structure.
 */
function dedupeTypes(
  types: (PseudoType | ArrayType | ShapeType)[],
): (PseudoType | ArrayType | ShapeType)[] {
  const seen = new Set<string>();
  const result: (PseudoType | ArrayType | ShapeType)[] = [];

  for (const type of types) {
    const key = typeToKey(type);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(type);
    }
  }

  return result;
}

/**
 * Convert a type to a string key for deduplication.
 */
function typeToKey(type: PseudoType | ArrayType | ShapeType): string {
  if (typeof type === 'string') return type;
  if (type.kind === 'array') return `array:${type.valueType}`;
  if (type.kind === 'shape') return `shape:${JSON.stringify(shapeToSimpleObject(type.shape))}`;
  return 'unknown';
}

/**
 * Convert a PropertyShape to a simple object for JSON serialization.
 */
function shapeToSimpleObject(shape: PropertyShape): unknown {
  if (shape.kind === 'primitive') {
    return { kind: 'primitive', type: shape.primitiveType };
  }
  if (shape.kind === 'array') {
    return {
      kind: 'array',
      itemShape: shape.itemShape ? shapeToSimpleObject(shape.itemShape) : null,
    };
  }
  if (shape.kind === 'object') {
    const props: Record<string, unknown> = {};
    if (shape.properties) {
      for (const [key, value] of shape.properties) {
        props[key] = shapeToSimpleObject(value);
      }
    }
    return { kind: 'object', properties: props };
  }
  return { kind: 'unknown' };
}

/**
 * Convert a type to a display string for hover/completions.
 */
export function typeToDisplayString(type: PseudoType | ArrayType | ShapeType | UnionType): string {
  if (typeof type === 'string') return type;
  if (type.kind === 'array') return `Array<${type.valueType}>`;
  if (type.kind === 'shape') return shapeToTypeString(type.shape);
  if (type.kind === 'union') return type.types.map((t) => typeToDisplayString(t)).join(' | ');
  return 'unknown';
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
      path.push(`${lookup.value}`);
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

/**
 * Find the last applicable shape for a variable at a given position
 */
function findLastApplicableShape(
  shapes: { shape: PropertyShape; rangeEnd: number }[],
  position: number,
): { shape: PropertyShape; rangeEnd: number } | undefined {
  let result: { shape: PropertyShape; rangeEnd: number } | undefined;
  for (const entry of shapes) {
    if (entry.rangeEnd < position) {
      result = entry;
    }
  }
  return result;
}

function settingReturnType(setting: InputSetting): ObjectEntry['return_type'] {
  switch (setting.type) {
    // basic settings
    case 'checkbox':
      return [{ type: 'boolean', name: '' }];

    case 'range':
    case 'number':
      return [{ type: 'number', name: '' }];

    case 'radio':
    case 'select':
    case 'text':
    case 'textarea':
      return [{ type: 'string', name: '' }];

    // specialized settings
    case 'article':
      return [{ type: 'article', name: '' }];

    case 'blog':
      return [{ type: 'blog', name: '' }];

    case 'collection':
      return [{ type: 'collection', name: '' }];

    case 'collection_list':
      return [{ type: 'array', array_value: 'collection' }];

    case 'color':
      return [{ type: 'color', name: '' }];

    case 'color_background':
      return [{ type: 'string', name: '' }];

    case 'color_scheme':
      return [{ type: 'color_scheme', name: '' }];

    // TODO ??
    case 'color_scheme_group':
      return [];

    case 'font_picker':
      return [{ type: 'font', name: '' }];

    case 'html':
      return [{ type: 'string', name: '' }];

    case 'image_picker':
      return [{ type: 'image', name: '' }];

    case 'inline_richtext':
      return [{ type: 'string', name: '' }];

    case 'link_list':
      return [{ type: 'linklist', name: '' }];

    case 'liquid':
      return [{ type: 'string', name: '' }];

    case 'page':
      return [{ type: 'page', name: '' }];

    case 'product':
      return [{ type: 'product', name: '' }];

    case 'product_list':
      return [{ type: 'array', array_value: 'product' }];

    case 'richtext':
      return [{ type: 'string', name: '' }];

    case 'text_alignment':
      return [{ type: 'string', name: '' }];

    case 'url':
      return [{ type: 'string', name: '' }];

    case 'video':
      return [{ type: 'video', name: '' }];

    case 'video_url':
      return [{ type: 'string', name: '' }];

    default:
      return [];
  }
}

const METAFIELD_TYPE_TO_TYPE = Object.freeze({
  single_line_text_field: String,
  multi_line_text_field: String,
  url_reference: String,
  date: String,
  date_time: String,
  number_integer: 'number',
  number_decimal: 'number',
  product_reference: 'product',
  collection_reference: 'collection',
  variant_reference: 'variant',
  page_reference: 'page',
  boolean: 'boolean',
  color: 'color',
  weight: 'measurement',
  volume: 'measurement',
  dimension: 'measurement',
  rating: 'rating',
  money: 'money',
  json: Untyped,
  metaobject_reference: 'metaobject',
  mixed_reference: Untyped,
  rich_text_field: Untyped,
  file_reference: Untyped,
});

const REFERENCE_TYPE_METAFIELDS = Object.entries(METAFIELD_TYPE_TO_TYPE)
  .filter(([metafieldType, _type]) => metafieldType.endsWith('_reference'))
  .map(([_metafieldType, type]) => type);

function metafieldReturnType(metafieldType: string): ObjectEntry['return_type'] {
  let isArray = metafieldType.startsWith('list.');

  if (isArray) {
    metafieldType = metafieldType.split('.')[1];
  }

  let type = 'metafield_' + ((METAFIELD_TYPE_TO_TYPE as any)[metafieldType] ?? Untyped);

  if (isArray) {
    return [{ type: `${type}_array`, name: '' }];
  }

  return [{ type: type, name: '' }];
}

// The default `metafield` type has an untyped `value` property.
// We need to create new metafield types with the labels `metafield_x` and `metafield_x_array`
// where x is the type of metafield inside the `value` property. The metafields ending with `x_array`
// is where the value is an array of type x.
const customMetafieldTypeEntries = memo((baseMetafieldEntry: ObjectEntry) => {
  if (!baseMetafieldEntry) return {} as ObjectMap;

  return [
    ...new Set([...Object.values(METAFIELD_TYPE_TO_TYPE), ...FETCHED_METAFIELD_CATEGORIES]),
  ].reduce((map, type) => {
    {
      const metafieldEntry = JSON.parse(JSON.stringify(baseMetafieldEntry)); // easy deep clone
      const metafieldValueProp = metafieldEntry.properties?.find(
        (prop: any) => prop.name === 'value',
      );

      if (metafieldValueProp) {
        metafieldValueProp.return_type = [{ type: type, name: '' }];
        metafieldValueProp.description = '';
        metafieldEntry.name = `metafield_${type}`;
        map[metafieldEntry.name] = metafieldEntry;
      }
    }

    {
      const metafieldArrayEntry = JSON.parse(JSON.stringify(baseMetafieldEntry)); // easy deep clone
      const metafieldArrayValueProp = metafieldArrayEntry.properties?.find(
        (prop: any) => prop.name === 'value',
      );

      if (metafieldArrayValueProp) {
        // A metafield definition using a list of references does not use an array, but a separate type of collection.
        // For auto-completion purposes, we can't use the array type
        // https://shopify.dev/docs/api/liquid/objects/metafield#metafield-determining-the-length-of-a-list-metafield
        if (REFERENCE_TYPE_METAFIELDS.includes(type as any)) {
          metafieldArrayValueProp.return_type = [{ type: 'untyped', name: '' }];
        } else {
          metafieldArrayValueProp.return_type = [{ type: 'array', name: '', array_value: type }];
        }
        metafieldArrayValueProp.description = '';
        metafieldArrayEntry.name = `metafield_${type}_array`;
        map[metafieldArrayEntry.name] = metafieldArrayEntry;
      }
    }

    return map;
  }, {} as ObjectMap);
});

function schemaSettingsAsProperties(ast: LiquidHtmlNode): ObjectEntry[] {
  if (ast.type !== NodeTypes.Document) return [];
  try {
    const source = ast._source; // (the unfixed source)
    const start = /\{%\s*schema\s*%\}/m.exec(source);
    const end = /\{%\s*endschema\s*%\}/m.exec(source);
    if (!start || !end) return [];
    const schema = source.slice(start.index + start[0].length, end.index);
    const json = parseJSON(schema);
    if (isError(json) || !('settings' in json) || !Array.isArray(json.settings)) return [];
    const result: ObjectEntry[] = [];
    const inputSettings = json.settings.filter(isInputSetting);
    for (const setting of inputSettings) {
      result.push({
        name: setting.id,
        summary: '', // TODO, this should lookup the locale file for settings... setting.label
        description: '', // TODO , this should lookup the locale file as well... setting.info,
        return_type: settingReturnType(setting),
        access: {
          global: false,
          parents: [],
          template: [],
        },
      });
    }
    return result;
  } catch (_) {
    return [];
  }
}
