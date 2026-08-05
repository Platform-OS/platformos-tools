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
  LiquidVariableOutput,
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
  ObjectEntry,
  ReturnType,
  ShapeAnalyzer,
  ShapeAnalyzerDeps,
  SourceCodeType,
  PlatformOSDocset,
  path,
  BasicParamTypes,
  buildLookupPath,
  createShapeAnalyzer,
  getValidParamTypes,
  inferShapeFromJSONString,
  lookupPropertyPath,
  parseParamType,
} from '@platformos/platformos-check-common';
import { findLast, memo } from './utils';
import { visit } from '@platformos/platformos-check-common';
import {
  PropertyShape,
  inferShapeFromJsonLiteral,
  shapeToTypeString,
  shapeToJSONPlaceholder,
} from './PropertyShapeInference';
import { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

export class TypeSystem {
  private graphqlSchemaCache: string | undefined;
  private graphqlSchemaLoaded = false;

  constructor(
    private readonly platformosDocset: PlatformOSDocset,
    private readonly fs?: AbstractFileSystem,
    private readonly documentsLocator?: DocumentsLocator,
    private readonly findAppRootURI?: (uri: string) => Promise<string | null>,
  ) {}

  private async getGraphQLSchema(): Promise<string | undefined> {
    if (!this.graphqlSchemaLoaded) {
      this.graphqlSchemaCache = (await this.platformosDocset.graphQL()) ?? undefined;
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

  /**
   * An indexed representation of objects.json by name
   *
   * e.g. objectMap['product'] returns the product ObjectEntry.
   */
  public objectMap = async (uri: string, ast: LiquidHtmlNode): Promise<ObjectMap> => {
    return this._objectMap();
  };

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
    return this.platformosDocset.filters();
  });

  public objectEntries = memo(async () => {
    return this.platformosDocset.objects();
  });

  private async symbolsTable(partialAst: LiquidHtmlNode, uri: string): Promise<SymbolsTable> {
    const [seedSymbolsTable, liquidDrops, graphqlSchema, rootUri, objectMap, filtersMap] =
      await Promise.all([
        this.seedSymbolsTable(uri),
        this.platformosDocset.liquidDrops(),
        this.getGraphQLSchema(),
        this.findAppRootURI?.(uri) ?? null,
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

const PARTIAL_FILE_REGEX = /(views[\/\\]partials[\/\\]|[\/\\]lib[\/\\])[^.]*\.liquid$/;

function getContextualEntries(uri: string): string[] {
  const normalizedUri = path.normalize(uri);
  if (PARTIAL_FILE_REGEX.test(normalizedUri)) {
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

/** Unknown is for variables that don't exist, type would come from context (e.g. partial var without LiquidDoc) */
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
  type:
    PseudoType | ArrayType | ShapeType | UnionType | LazyVariableType | LazyDeconstructedExpression;

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
  // ONE answer to "what shape does this variable have", shared with `UnknownProperty`.
  // Do not track shapes here as well; a second copy drifts.
  //
  // Fed first, in source order, so the pass below can ask it about any position.
  const analyzer = createShapeAnalyzer({
    ...shapeAnalyzerDeps(graphqlSchema, fs, documentsLocator, rootUri),
    // The docset half of the answer, which no diagnostic needs: `context.current_user`
    // has properties because the docset says so, not because this file assigned it.
    resolveExternalShape: (read, position) => externalShape(read, position),
  });
  const externalShape = resolveExpressionShape(analyzer, seedSymbolsTable, objectMap);

  await visit<SourceCodeType.LiquidHtml, void>(partialAst, {
    async LiquidTag(node, ancestors) {
      await analyzer.handleLiquidTag(node, ancestors);
    },
  });

  const typeRanges = await visit<SourceCodeType.LiquidHtml, TypeRange | TypeRange[]>(partialAst, {
    // {% assign x = foo.x | filter %}
    // {% assign x = '{"a": 1}' | parse_json %}
    // {% assign x = {a: 1, b: "hello"} %}
    // {% assign x["key"] = value %}
    // {% assign arr << item %}
    async AssignMarkup(node, ancestors) {
      const value = node.value as LiquidVariable;
      const shape = analyzer.shapeAt(node.name, afterTag(ancestors));

      if (shape) {
        return { identifier: node.name, type: shapeType(shape), range: [node.position.end] };
      }

      // A write THROUGH the name — `x['k'] = v`, `x << v` — says nothing about the type
      // of `x` itself, so the right-hand side is not its type either.
      if (node.lookups.length > 0 || node.operator === '<<') {
        return { identifier: node.name, type: Untyped, range: [node.position.end] };
      }

      // No shape: the docset decides, through the filters and lookups on the value.
      return {
        identifier: node.name,
        type: lazyVariable(value, node.position.start),
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
      }
      // NO `layout` BRANCH. This used to introduce `none` as a keyword inside
      // `{% layout none %}`, which drove hover and completion for it — and platformOS has no
      // `layout` tag. Measured: `Unknown tag 'layout'` from both `--dry-run` and `liquid_exec`,
      // and a converter rejection fails the WHOLE changeset. So the editor was autocompleting
      // an author into a deploy-wide failure, which is worse than offering nothing.
      //
      // TASK-44 removed the grammar rule, so the markup is now an unparsed string and there is
      // no identifier node here for this to describe. Removing it is therefore both correct and
      // necessary — it could not fire again. platformOS selects a layout from FRONTMATTER, and
      // `FrontmatterKeyCompletionProvider` already completes layout NAMES there, which is where
      // the help belongs.
      // Everything that assigns a SHAPE — `{% parse_json %}`, `{% graphql %}` (inline
      // and file-based), `{% hash_assign %}`, `{% function %}` — is one question now,
      // asked of the analyzer that already walked this file.
      else if (
        isLiquidTagParseJson(node) ||
        isLiquidTagGraphQL(node) ||
        isLiquidTagHashAssign(node) ||
        isLiquidTagFunction(node)
      ) {
        const identifier = shapeTargetName(node);
        if (!identifier) return;

        // Where the value starts being current, which is also where the analyzer
        // recorded the write — so ask it one character later.
        const rangeStart = node.blockEndPosition?.end ?? node.position.end;
        const shape = analyzer.shapeAt(identifier, rangeStart + 1);
        if (shape) {
          return { identifier, type: shapeType(shape), range: [rangeStart] };
        }

        // A `{% parse_json %}` body with a `{{ … | json }}` in it is a document the
        // analyzer refuses to read, because a tolerant JSON parser reads it one key
        // short of the truth and a diagnostic must not act on that. Completion and
        // hover CAN: substituting a placeholder per interpolation gives the keys.
        if (isLiquidTagParseJson(node)) {
          const interpolated = parseJsonBodyShape(node, (expr) =>
            externalShape(expr, node.position.start),
          );
          if (interpolated) {
            return { identifier, type: shapeType(interpolated), range: [rangeStart] };
          }
        }

        // A `{% function %}` whose callee returns something the analyzer cannot shape —
        // a documented object, a string, one type per branch — still has a type.
        if (
          isLiquidTagFunction(node) &&
          fs &&
          documentsLocator &&
          rootUri &&
          objectMap &&
          filtersMap
        ) {
          const returnType = isLiquidString(node.markup.partial)
            ? await inferFunctionReturnType(
                node.markup.partial.value,
                fs,
                documentsLocator,
                rootUri,
                seedSymbolsTable,
                liquidDrops,
                graphqlSchema,
                processingFiles,
                objectMap,
                filtersMap,
              ).catch(() => undefined)
            : undefined;
          // A function result is in scope whatever it holds, so it is named either way.
          return { identifier, type: returnType ?? Untyped, range: [rangeStart] };
        }

        // A `{% parse_json %}` whose body is not JSON at all names nothing — there is no
        // value to put in scope. Every other tag here holds SOMETHING, so it is named
        // untyped rather than left out.
        return isLiquidTagParseJson(node)
          ? undefined
          : { identifier, type: Untyped, range: [rangeStart] };
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

    // JSON literal expressions: {key: val} or [1, 2, 3]
    case NodeTypes.JsonHashLiteral:
    case NodeTypes.JsonArrayLiteral: {
      const resolver = (expr: LiquidExpression): PropertyShape | undefined => {
        const type = inferType(expr, symbolsTable, objectMap, filtersMap);
        return resolvedTypeToShape(type);
      };
      return shapeType(inferShapeFromJsonLiteral(thing, resolver));
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

  // Neither `object` nor `array` names an item type the type system can use — `array` is
  // already the array of unknowns that the `[]` suffix would produce.
  if (type === BasicParamTypes.Object) {
    transformedParamType = Untyped;
  } else if (type === BasicParamTypes.Array) {
    return arrayType(Untyped);
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

/**
 * Convert a resolved type back to a PropertyShape (inverse of shapeToType).
 * Used when embedding resolved variable types into JSON literal shapes.
 */
function resolvedTypeToShape(
  type: PseudoType | ArrayType | ShapeType | UnionType,
): PropertyShape | undefined {
  if (typeof type === 'string') {
    switch (type) {
      case 'string':
        return { kind: 'primitive', primitiveType: 'string' };
      case 'number':
        return { kind: 'primitive', primitiveType: 'number' };
      case 'boolean':
        return { kind: 'primitive', primitiveType: 'boolean' };
      default:
        // A documented object — `product`, `context` — has no shape: it has an ENTRY,
        // with properties and documentation a shape cannot carry. Calling it a primitive,
        // as this did, made every caller stop resolving and show "any" instead.
        return undefined;
    }
  }
  if (isShapeType(type)) return type.shape;
  if (isArrayType(type)) {
    // An array OF a documented object is in the same position as the object itself: an
    // array shape with an unknown item hides the entry that `x.first.` completes from.
    const itemShape = resolvedTypeToShape(type.valueType);
    return itemShape ? { kind: 'array', itemShape } : undefined;
  }
  return undefined;
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

function isLiquidString(node: LiquidString | LiquidVariableLookup): node is LiquidString {
  return node.type === NodeTypes.String;
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}

/**
 * A `{% function %}` whose markup the parser STRUCTURED. The tag name survives the
 * tolerant parser's fallback to a raw markup string, so a name test alone reaches a
 * string and `markup.name.name` throws — the defect that cost `PartialCallArguments`
 * the rest of a file in check-common.
 */
function isLiquidTagFunction(node: LiquidTag): node is LiquidTag & { markup: FunctionMarkup } {
  return (
    node.name === NamedTags.function &&
    typeof node.markup !== 'string' &&
    node.markup.type === NodeTypes.FunctionMarkup
  );
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
        if (
          node.name === NamedTags.return &&
          node.markup !== null &&
          typeof node.markup !== 'string'
        ) {
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
 * The position just past the tag being visited — where the analyzer recorded the write
 * that tag performs, so a query one character later reads the NEW value rather than the
 * one it replaced.
 */
function afterTag(ancestors: LiquidHtmlNode[]): number {
  const tag = findLast(ancestors, (node) => node.type === NodeTypes.LiquidTag) as
    LiquidTag | undefined;
  if (!tag) return 0;
  return (tag.blockEndPosition?.end ?? tag.position.end) + 1;
}

/** The variable a shape-assigning tag writes to, however that tag spells its target. */
function shapeTargetName(node: LiquidTag): string | undefined {
  if (isLiquidTagHashAssign(node)) return node.markup.target.name ?? undefined;
  if (isLiquidTagFunction(node)) {
    // `{% function hash['key'] = 'partial' %}` writes into a hash; the analyzer tracks
    // that under the hash's own name, and there is no new variable to name here.
    return node.markup.name.lookups.length > 0 ? undefined : (node.markup.name.name ?? undefined);
  }
  if (typeof node.markup === 'string') return undefined;
  return (node.markup as { name?: string }).name ?? undefined;
}

/**
 * The shape of a `{% parse_json %}` body that INTERPOLATES a value, by standing a JSON
 * placeholder in for each `{{ … | json }}`.
 *
 * The analyzer refuses this document — a tolerant parser reads it one key short of the
 * truth, and `UnknownProperty` would report the missing key. Hover and completion have
 * no such stake: the keys are worth having even when one value is a guess.
 */
function parseJsonBodyShape(
  node: LiquidTag & { children?: LiquidHtmlNode[] },
  resolveExpression: (read: LiquidVariableLookup) => PropertyShape | undefined,
): PropertyShape | undefined {
  const children = node.children ?? [];
  if (!children.some((child) => child.type === NodeTypes.LiquidVariableOutput)) return undefined;

  const body = children
    .map((child) => {
      if (child.type === NodeTypes.TextNode) return (child as TextNode).value;
      if (child.type === NodeTypes.LiquidVariableOutput) {
        const variable = (child as LiquidVariableOutput).markup;
        if (typeof variable === 'string') return 'null';
        const isJson = variable.filters?.at(-1)?.name === 'json';
        return isJson && variable.expression.type === NodeTypes.VariableLookup
          ? shapeToJSONPlaceholder(resolveExpression(variable.expression))
          : 'null';
      }
      return 'null';
    })
    .join('');

  return inferShapeFromJSONString(body);
}

/**
 * What the shape analyzer needs from this package: the `.graphql` documents and partials
 * a tag names, resolved the way every other language server feature resolves them.
 *
 * Without a filesystem — the type system is constructible without one — the reads fail
 * and the analyzer treats a file-based `{% graphql %}` or `{% function %}` as an
 * assignment of unknown structure, which is what this file did before it had an
 * analyzer at all.
 */
function shapeAnalyzerDeps(
  graphqlSchema: string | undefined,
  fs: AbstractFileSystem | undefined,
  documentsLocator: DocumentsLocator | undefined,
  rootUri: string | undefined,
): ShapeAnalyzerDeps {
  const locate = async (kind: 'graphql' | 'function', name: string) => {
    if (!fs || !documentsLocator || !rootUri) return undefined;
    try {
      return (await documentsLocator.locate(URI.parse(rootUri), kind, name)) ?? undefined;
    } catch {
      return undefined;
    }
  };

  const readContent = async (uri: string) => {
    if (!fs) return undefined;
    try {
      return await fs.readFile(uri);
    } catch {
      return undefined;
    }
  };

  return {
    async readGraphQL(name) {
      const uri = await locate('graphql', name);
      if (!uri) return undefined;
      const content = await readContent(uri);
      return content === undefined ? undefined : { uri, content };
    },

    async readPartial(name) {
      const uri = await locate('function', name);
      if (!uri) return undefined;
      const source = await readContent(uri);
      if (source === undefined) return undefined;
      try {
        return { uri, source, ast: toLiquidHtmlAST(source) };
      } catch {
        return undefined;
      }
    },

    readContent,

    async getSchema() {
      return graphqlSchema;
    },
  };
}

/**
 * What the DOCSET knows about a read the analyzer could not resolve.
 *
 * `{ "user": context.current_user }` is a shape only because `context` is a documented
 * object with documented properties — nothing in the file assigns it. This is the one
 * piece of shape knowledge that belongs to the editor rather than to the checks, and it
 * reaches the analyzer as its `resolveExternalShape` seam.
 *
 * The analyzer is consulted FIRST for the base name, so a variable the file assigns wins
 * over a global of the same name, exactly as it does at runtime.
 */
function resolveExpressionShape(
  analyzer: ShapeAnalyzer,
  seedSymbolsTable: SymbolsTable,
  objectMap?: ObjectMap,
): (read: LiquidVariableLookup, position: number) => PropertyShape | undefined {
  return (read, position) => {
    if (!read.name) return undefined;

    let shape = analyzer.shapeAt(read.name, position);
    /** The docset object the read is standing on, while it still is one. */
    let pseudoType: string | undefined;

    if (!shape) {
      for (const typeRange of seedSymbolsTable[read.name] ?? []) {
        if (typeRange.range[0] >= position) continue;
        if (typeof typeRange.type === 'string') {
          pseudoType = typeRange.type;
          shape = resolvedTypeToShape(typeRange.type);
        } else if (typeRange.type.kind === 'shape') {
          shape = typeRange.type.shape;
        } else if (typeRange.type.kind === 'array') {
          shape = resolvedTypeToShape(typeRange.type);
        }
      }
    }

    if (!shape && !pseudoType) return undefined;

    for (const lookup of read.lookups) {
      // e.g. `context.current_user`, where the property's type comes from the docset.
      if (pseudoType !== undefined && objectMap) {
        if (lookup.type !== NodeTypes.String) return undefined;
        const propertyType = inferPseudoTypePropertyType(pseudoType, lookup, objectMap);
        if (typeof propertyType === 'string') {
          pseudoType = propertyType;
          shape = resolvedTypeToShape(propertyType);
        } else if (isArrayType(propertyType)) {
          pseudoType = undefined;
          shape = resolvedTypeToShape(propertyType);
        } else {
          return undefined;
        }
        continue;
      }

      if (!shape) return undefined;
      pseudoType = undefined;

      const path = buildLookupPath([lookup]);
      if (!path) return undefined;
      const result = lookupPropertyPath(shape, path);
      if (result.error || !result.shape) return undefined;
      shape = result.shape;
    }

    // A documented object is a TYPE, not a shape. Flattening `context` or a `product`
    // into a shape says only "some value" — while COSTING the caller the docset entry it
    // would otherwise have resolved, which is where the hover text and the property list
    // come from. Declining loses nothing: an unresolved read and a flattened one present
    // identically.
    if (pseudoType !== undefined && !PRIMITIVE_PSEUDO_TYPES.has(pseudoType)) return undefined;

    return shape;
  };
}

/** The pseudo-types that ARE a shape, rather than a name the docset describes. */
const PRIMITIVE_PSEUDO_TYPES = new Set<string>(['string', 'number', 'boolean']);
