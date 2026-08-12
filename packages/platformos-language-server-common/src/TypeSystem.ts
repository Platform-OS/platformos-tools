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
  LiquidFilter,
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
  DECLARABLE_TYPES,
  alternativeSubstituteArg,
  buildLookupPath,
  createShapeAnalyzer,
  inferShapeFromJSONString,
  isAlternativeReturningFilter,
  isLiquidDocument,
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
import {
  AbstractFileSystem,
  App,
  AppFile,
  AppResolver,
  DocumentsLocator,
  GraphQLDocumentNode,
  PlatformOSFileType,
  isGraphqlDocument,
  isObjectInScope,
  parseGraphql,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

/**
 * The platformOS type of the file a request is about — {@link DocumentManager.fileType}, handed in
 * rather than re-derived, so the editor and `UndefinedObject` classify one file the same way.
 */
export type GetFileType = (uri: string) => Promise<PlatformOSFileType | undefined>;

export class TypeSystem {
  private graphqlSchemaCache: string | undefined;
  private graphqlSchemaLoaded = false;

  constructor(
    private readonly platformosDocset: PlatformOSDocset,
    private readonly fs?: AbstractFileSystem,
    private readonly documentsLocator?: DocumentsLocator,
    private readonly findAppRootURI?: (uri: string) => Promise<string | null>,
    /**
     * The {@link App} backing a project root, when the host has one — the language
     * server's `DocumentManager`. It is what the shape analyzer reads a `.graphql`
     * document from, so the document the editor infers a type from is the one the
     * diagnostics already parsed, rather than a second parse of the same bytes.
     */
    private readonly getApp?: AppResolver,
    /**
     * The file's platformOS type, for the objects whose scope depends on it. Absent — a host
     * that cannot classify — leaves every restricted object OUT, which is the direction that
     * cannot offer a name the platform does not provide.
     */
    private readonly getFileType?: GetFileType,
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
   * e.g. objectMap['current_user'] returns the current_user ObjectEntry.
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

  /**
   * An indexed representation of filters.json by name.
   *
   * ROW ORDER MUST NOT DECIDE THE ANSWER. `filters.json` once carried two entries named `split` —
   * the core Liquid one, whose `return_type` names `string` as the element, and the platformOS one,
   * whose `array_value` is empty — and a plain last-wins reduce made whichever the file happened to
   * list second the authority. A docset refresh swapped exactly those two rows, and with them the
   * loop-item type of every `{% for p in parts %}` over a `split` result, from `string` to nothing:
   * hover and member completion on the elements went blank with no code change and no test failing.
   *
   * So the entry carrying a usable return type wins, and a later duplicate can only ADD data, never
   * remove it. Resolving duplicates is the docset's business — `verify_filters_json.rb` gates them
   * upstream, and the shipped `filters.json` currently has none — but this stays: the gate is
   * upstream of a file this repository re-downloads, so an editor feature must not become
   * order-dependent on the strength of a guarantee enforced somewhere else. `tags.json`, which has
   * no such merge, still ships two `else` rows.
   */
  public filtersMap = memo(async (): Promise<FiltersMap> => {
    const entries = await this.filterEntries();
    return entries.reduce((map, entry) => {
      const existing = map[entry.name];
      if (!existing || !hasReturnTypeData(existing)) map[entry.name] = entry;
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
      rootUri ? this.getApp?.(rootUri) : undefined,
      uri,
    );
  }

  /**
   * The seedSymbolsTable contains all the global variables.
   *
   * This lets us have the ambient type of things first, but if someone
   * reassigns the variable, then we'll be able to change its type on
   * the appropriate range.
   *
   * This is not memo'ed because we would otherwise need to clone the thing.
   */
  private seedSymbolsTable = async (uri: string) => {
    const globalVariables = await this.globalVariables(uri);
    return globalVariables.reduce((table, objectEntry) => {
      table[objectEntry.name] ??= [];
      table[objectEntry.name].push({
        identifier: objectEntry.name,
        type: objectEntryType(objectEntry),
        range: [0],
      });
      return table;
    }, {} as SymbolsTable);
  };

  /**
   * The docset objects in scope in the file at `uri`, through the SAME predicate `UndefinedObject`
   * judges them with.
   *
   * There used to be a second implementation here — `!entry.access || entry.access.global === true`
   * — and `access.global` does not mean "in scope everywhere", it means "needs no parent". Against
   * the shipped `objects.json` the two answers contradicted each other in four places: the editor
   * offered `data` and `response` (api_call objects) in every partial, `content_for_layout` outside
   * a layout, and `forloop` outside its loop, and the linter then reported `Unknown object` on the
   * code the editor had just completed. The tool that suggests and the tool that judges must not
   * disagree; where they do, the diagnostic wins.
   *
   * Not memoized. The answer depends on the file, and the scan is over ~25 entries; a per-file memo
   * would cache a value whose key is the type rather than the URI, which is the kind of subtlety
   * that put the second predicate here in the first place.
   */
  private globalVariables = async (uri: string) => {
    const [entries, fileType] = await Promise.all([
      this.objectEntries(),
      this.getFileType?.(uri) ?? undefined,
    ]);
    return entries.filter((entry) => isObjectInScope(entry.access, fileType));
  };
}

/** An indexed representation on objects.json (by name) */
type ObjectMap = Record<ObjectEntryName, ObjectEntry>;

/** An indexed representation on filters.json (by name) */
type FiltersMap = Record<FilterEntryName, FilterEntry>;

/** An identifier refers to the name of a variable, e.g. `x`, `current_user`, etc. */
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
 *   {% assign x = context.current_user %}
 *   {{ x }} # current_user
 *   {% assign x = x.email %}
 *   {{ x }} # string
 *   {% assign x = x | upcase %}
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

/** Some things can be an array type (e.g. the result of `| split: ','`) */
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

/**
 * Every parameter is REQUIRED, `undefined` spelled out where a caller has nothing to give.
 * Optional reads as convenience on a list this long and is not: the last of them decides this
 * table's shape-analysis cache identity, so a default lets a new call site share another
 * file's entries by forgetting an argument.
 */
async function buildSymbolsTable(
  partialAst: LiquidHtmlNode,
  seedSymbolsTable: SymbolsTable,
  liquidDrops: ObjectEntry[],
  graphqlSchema: string | undefined,
  fs: AbstractFileSystem | undefined,
  documentsLocator: DocumentsLocator | undefined,
  rootUri: string | undefined,
  processingFiles: Set<string> | undefined,
  objectMap: ObjectMap | undefined,
  filtersMap: FiltersMap | undefined,
  app: App | undefined,
  /** The file this table is FOR — see `analysisIdentity` in `shapeAnalyzerDeps`. */
  uri: string,
): Promise<SymbolsTable> {
  // ONE answer to "what shape does this variable have", shared with `UnknownProperty`.
  // Do not track shapes here as well; a second copy drifts.
  //
  // Fed first, in source order, so the pass below can ask it about any position.
  const analyzer = createShapeAnalyzer({
    ...shapeAnalyzerDeps(graphqlSchema, fs, documentsLocator, rootUri, app, uri),
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
          /**
           * THE OPERATOR DECIDES WHAT THE VARIABLE HOLDS. `{% function items << 'p' %}` APPENDS to
           * `items`, so it holds an ARRAY of the partial's return values, not one of them — typing
           * it as the return value made completion offer the returned hash's keys directly on
           * `items`.
           *
           * The array is spelled, not given up on. An earlier revision named the append `Untyped`
           * on the grounds that "there is no array-of<T> spelling here", and that was simply wrong
           * about this file: {@link ArrayType} exists for a pseudo-type element, an array-shaped
           * {@link ShapeType} exists for a structural one, and `inferShapeTypeLookupType` already
           * resolves `[0]`, `first`, `last` and `size` on the latter. `shape-analysis.ts` models
           * the same array for `UnknownProperty`; agreeing with it is the point.
           */
          const returned = isLiquidString(node.markup.partial)
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
                app,
              ).catch(() => undefined)
            : undefined;

          const returnType = node.markup.operator === '<<' ? arrayOf(returned) : returned;
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
        // A filter returning one of its OPERANDS has no type of its own; the docset says
        // `untyped`, so which operand it is has to be decided here.
        if (isAlternativeReturningFilter(lastFilter.name)) {
          const alternative = alternativeFilterType(
            thing,
            lastFilter,
            symbolsTable,
            objectMap,
            filtersMap,
          );
          if (alternative !== undefined) return alternative;
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

/**
 * Which operand of a `| default:` the value comes from, or `undefined` when neither can be
 * named and the caller should fall back to the filter's declared return type.
 *
 * THE RULE, in order:
 *
 *  1. The piped operand PROVABLY does not flow — it is blank, and `default` substitutes for
 *     any blank value — so the fallback is the value. A piped `''` is typed `string`, neither
 *     `Untyped` nor `Unknown`, so step 2 alone would name the operand that never arrives.
 *  2. The piped operand has a type — it may or may not be blank, and nothing here can tell —
 *     so name it. That is what makes `{{ user | default: '' }}` complete as a user rather than
 *     as a string, which is the common shape and what the author meant.
 *  3. Nothing is known about the piped operand: the case the fallback was written for.
 *
 * Only step 1 is a proof; step 2 is a preference, and it is wrong for a piped value that
 * happens to be blank at runtime. There is no third answer available: a union of the two
 * would be the honest type, and `inferLookupType` resolves a `UnionType` to `Untyped`, so it
 * would cost both operands' members rather than pick the wrong one.
 */
function alternativeFilterType(
  thing: LiquidVariable,
  lastFilter: LiquidFilter,
  symbolsTable: SymbolsTable,
  objectMap: ObjectMap,
  filtersMap: FiltersMap,
): PseudoType | ArrayType | ShapeType | UnionType | undefined {
  // `{{ x | default }}` and `{{ x | default: allow_false: true }}` name no substitute at all,
  // which `filter-semantics.ts` answers for — it owns the `alternative` row this reads.
  const substitute = alternativeSubstituteArg(lastFilter);
  const substituteType = () =>
    substitute && inferType(substitute, symbolsTable, objectMap, filtersMap);

  const piped = { ...thing, filters: thing.filters.slice(0, -1) };
  // A filter between the value and the `default` produces something whose blankness is not
  // ours to judge, so the proof is only available on a bare expression.
  if (substitute && piped.filters.length === 0 && isProvablyBlank(piped.expression, symbolsTable)) {
    return substituteType();
  }

  const pipedType = inferType(piped, symbolsTable, objectMap, filtersMap);
  if (pipedType !== Untyped && pipedType !== Unknown) return pipedType;
  // Inferred only now: on the common path the piped value answers, and the substitute may be
  // a variable lookup whose own resolution is a walk of the symbols table.
  return substituteType();
}

/**
 * Whether an expression is a value `default` SUBSTITUTES FOR — proven, never guessed.
 *
 * Liquid's `default` fires on a blank value, not a false one:
 * `input.respond_to?(:empty?) ? input.empty? : !input`. So `''`, `false`, `nil` and an empty
 * literal are blank, and `0` is NOT — `0.empty?` does not exist and `!0` is false in Ruby, so
 * a zero flows through. `blank` and `empty` are spellings of `''` in this parser, so they
 * arrive here as literals already.
 *
 * A bare variable is followed to what it was assigned, because that is where the case comes
 * from — nobody writes `'' | default:`, they write `{% assign title = '' %}` twenty lines
 * earlier. `seen` stops `{% assign a = b %}{% assign b = a %}`, which a half-typed buffer
 * produces, from recursing forever.
 */
function isProvablyBlank(
  expression: ComplexLiquidExpression,
  symbolsTable: SymbolsTable,
  seen: Set<string> = new Set(),
): boolean {
  if (expression.type === NodeTypes.String) return expression.value === '';
  if (expression.type === NodeTypes.LiquidLiteral) return !expression.value;
  if (expression.type === NodeTypes.JsonHashLiteral) return expression.entries.length === 0;
  if (expression.type === NodeTypes.JsonArrayLiteral) return expression.elements.length === 0;
  if (expression.type !== NodeTypes.VariableLookup) return false;

  // Only the name itself: `a.b` is a read out of a value whose contents are not tracked here.
  const identifier = expression.name;
  if (!identifier || expression.lookups.length > 0 || seen.has(identifier)) return false;
  seen.add(identifier);

  const typeRange = findLast(symbolsTable[identifier] ?? [], (range) =>
    isCorrectTypeRange(range, expression),
  );
  const assigned = typeRange?.type;
  // Anything already resolved to a type has lost the value it was assigned, and a filtered
  // assignment produces a value this cannot see into.
  if (typeof assigned === 'string') return false;
  if (assigned?.kind !== NodeTypes.LiquidVariable || assigned.node.filters.length > 0) {
    return false;
  }

  return isProvablyBlank(assigned.node.expression, symbolsTable, seen);
}

/**
 * The declared type of a `@param`, as a type this system can carry.
 *
 * INFERENCE, NOT VALIDATION, and the distinction is why this asks no docset what an author is allowed
 * to write. A name it cannot represent becomes `Untyped`, which is what it already did for every
 * unrecognised spelling; whether that name was legal is `ValidDocParamTypes`' question, and that check
 * reads the published vocabulary to answer it. Two features would otherwise have to agree about the
 * list, which is how this repository ended up with several copies of it.
 */
function inferLiquidDocParamType(node: LiquidDocParamNode, liquidDrops: ObjectEntry[]) {
  const paramTypeValue = node.paramType?.value;

  if (!paramTypeValue) return Untyped;

  // Every name this can DO something with: a type inference already speaks, or an object a value can
  // be an instance of.
  const knownParamTypes = new Set<string>([
    ...DECLARABLE_TYPES,
    ...liquidDrops.map((drop) => drop.name),
  ]);

  const parsedParamType = parseParamType(knownParamTypes, paramTypeValue);

  if (!parsedParamType) return Untyped;

  const [type, isArray] = parsedParamType;

  let transformedParamType;

  // Neither `object` nor `array` names an item type the type system can use — `array` is
  // already the array of unknowns that the `[]` suffix would produce.
  if (type === 'object') {
    transformedParamType = Untyped;
  } else if (type === 'array') {
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
   * - curr = x.parts -> ArrayType<string>      | x.parts
   * - curr = parts.first -> string             | x.parts.first
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

    // e.g. parts[0] -> string
    // e.g. parts.first -> string
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

    // e.g. context.current_user -> current_user
    // e.g. x.parts -> ArrayType<string>
    // e.g. current_user.email -> string
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
 *   {% assign x = context.current_user %}
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
  // e.g. {{ ['current_user'] }}
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
 * - parts[0] becomes 'string'
 * - parts[index] becomes 'string'
 * - parts.first becomes 'string'
 * - parts.last becomes 'string'
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
        // A documented object — `current_user`, `context` — has no shape: it has an ENTRY,
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
  // parts[0]
  // parts[true]
  // parts[(0..10)]
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
  // current_user.foo
  // current_user.bar
  if (!property) {
    // Debating between returning Untyped or Unknown here
    // Might be that we have outdated docs. Prob better to return Untyped.
    return Untyped;
  }

  // When the property is known & we have docs for it, return its type. e.g.
  // current_user.email
  // context.current_user
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
 *
 * DELIBERATELY NOT check-common's `docsetReturnType`, which answers the same question in the
 * narrower `LiquidType` vocabulary. Two things are lost in that vocabulary and both are load-bearing
 * here:
 *
 * - An OBJECT NAME. `PseudoType` includes every docset entry name, so `current_user` stays
 *   `current_user` and hover and member completion resolve from its docset entry. Flattening it to
 *   `object` is the mistake that cost ten LSP tests when the shape analyzer tried it.
 * - An ELEMENT TYPE. `arrayType(array_value)` keeps what a `split` result holds, which is what types
 *   the loop variable in `{% for part in parts %}`. `LiquidType` has one flat `array`.
 *
 * The diagnostics need neither, and paying for them would mean a type a check cannot act on. What
 * the two DO share is the docset field they read; nothing here may grow an opinion about what a
 * filter returns that `filters.json` does not state.
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

/**
 * Whether the entry's `return_type` says anything {@link docsetEntryReturnType} can use.
 *
 * A PRESENT-BUT-EMPTY array element counts as nothing, which is the case that matters: the
 * platformOS `split` entry publishes `[{ type: 'array', array_value: '' }]`, so a length check
 * alone would rank it equal to the core entry's `array_value: 'string'` and let row order pick.
 */
function hasReturnTypeData(entry: ObjectEntry | FilterEntry): boolean {
  const returnType = entry.return_type?.[0];
  if (!returnType) return false;
  return isArrayReturnType(returnType) ? !!returnType.array_value : !!returnType.type;
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

/**
 * An array of `element`, in whichever of this file's two array spellings fits it.
 *
 * A structural element becomes an array-shaped {@link ShapeType}, which `shapeToType` produces
 * from the analyzer's shapes and `inferShapeTypeLookupType` already knows how to subscript; a
 * pseudo-type element becomes an {@link ArrayType}. An array OF an array, or of a union, has no
 * spelling here and stays untyped — that one really is a gap, and it is a narrow one.
 */
function arrayOf(
  element: PseudoType | ArrayType | ShapeType | UnionType | undefined,
): PseudoType | ArrayType | ShapeType | undefined {
  if (element === undefined) return undefined;
  if (typeof element === 'string') return arrayType(element);
  if (element.kind === 'shape') return shapeType({ kind: 'array', itemShape: element.shape });
  return undefined;
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
  app?: App,
): Promise<PseudoType | ArrayType | ShapeType | UnionType | undefined> {
  // 1. Locate the file
  const located = await documentsLocator.locate(URI.parse(rootUri), 'function', partialPath);
  if (!located) return undefined;

  // 2. Check for circular references
  const trackingSet = processingFiles ?? new Set<string>();
  if (trackingSet.has(located)) return Untyped;
  trackingSet.add(located);

  try {
    // 3. The partial's source and parse — the app's when it has them, so the partial is
    // parsed once for the whole session rather than once per `{% function %}` that names
    // it. The analyzer's `readPartial` resolves the same way.
    const partial = await readLiquidFile(located, fs, app);
    if (!partial) return undefined;
    const partialAst = partial.ast;

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
      app,
      located,
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
  app: App | undefined,
  /** The file whose symbols table this builds — see `analysisIdentity` below. */
  uri: string,
): ShapeAnalyzerDeps {
  const locate = async (kind: 'graphql' | 'function', name: string) => {
    if (!fs || !documentsLocator || !rootUri) return undefined;
    try {
      return (await documentsLocator.locate(URI.parse(rootUri), kind, name)) ?? undefined;
    } catch {
      return undefined;
    }
  };

  /** Buffer first, then disk — see {@link readSource}, which every read here goes through. */
  const readContent = (uri: string) => readSource(uri, fs, app);

  /**
   * A document a tag names is read and parsed ONCE per symbols table, not once per call
   * site: a page that names the same query or the same partial from five places used to
   * pay for five reads and five parses. Scoped to this deps object, which lives for
   * exactly one table build, so it cannot serve a stale document to a later one.
   *
   * When the host has an {@link App} there is nothing left to read or parse at all — see
   * {@link readLiquidFile}.
   */
  const graphqlDocuments = new Map<
    string,
    Promise<{ uri: string; ast: GraphQLDocumentNode } | undefined>
  >();
  const partials = new Map<string, Promise<AnalyzablePartial | undefined>>();

  return {
    /**
     * What this deps object's `resolveExternalShape` answers does NOT depend on the URI, so the
     * identity is a constant.
     *
     * It used to carry the file's kind, because the seed symbols table added a contextual `app`
     * for a partial or lib file. That object is Shopify's and is in no platformOS docset, so the
     * two buckets the kind selected always held the same answer; the globals are the same
     * everywhere and `objectMap` ignores its URI altogether.
     *
     * Not per-FILE, and this is the reason to keep it constant rather than "simplify" it later:
     * the cache is module-level and capped, and `runPartialAnalysis` builds the nested analyzer
     * from these same deps, so a per-file identity keys a partial's entire `{% function %}` chain
     * on whichever page reached it — forty pages sharing a five-deep chain would hold 240 entries
     * and recompute the chain forty times. Per-OBJECT identity would be worse still: a fresh deps
     * object is built for every symbols table, so the memo would miss on every keystroke.
     *
     * Nothing about the resolver's presence is stated here — the cache reads that off `deps`
     * itself, which is what keeps the check next door from ever being handed one of these.
     */
    analysisIdentity: 'language-server/TypeSystem',

    readGraphQL: (name) =>
      once(graphqlDocuments, name, async () => {
        const uri = await locate('graphql', name);
        if (!uri) return undefined;

        const file = await loadedAppFile(uri, app);
        if (file && isGraphqlDocument(file.ast)) return { uri, ast: file.ast };

        const content = await readContent(uri);
        return content === undefined ? undefined : { uri, ast: parseGraphql(content) };
      }),

    readPartial: (name) =>
      once(partials, name, async () => {
        const uri = await locate('function', name);
        if (!uri) return undefined;
        const read = await readLiquidFile(uri, fs, app);
        return read && { uri, ...read };
      }),

    readContent,

    /**
     * The same number the linter's analyzer records, from the same `App` — which is what
     * lets the two of them share the memo without either being able to serve the other a
     * reading of a file neither of them has now.
     */
    revisionOf: (uri: string) => app?.get(uri)?.revision,

    async getSchema() {
      return graphqlSchema;
    },
  };
}

/** What {@link ShapeAnalyzerDeps.readPartial} answers with. */
type AnalyzablePartial = { uri: string; source: string; ast: LiquidHtmlNode };

/** Memoize by name for the lifetime of the map, misses included. */
function once<T>(
  cache: Map<string, Promise<T | undefined>>,
  key: string,
  produce: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const cached = cache.get(key);
  if (cached) return cached;

  const value = produce();
  cache.set(key, value);
  return value;
}

/**
 * A Liquid file's source and parse, from the {@link App} when the host has one.
 *
 * The `AppFile` owns that parse, so a partial called from thirty places is parsed once —
 * and it is the SAME parse the diagnostics over these buffers used, so the editor and the
 * check beside it cannot hold different opinions about what the partial says. A URI the
 * app does not have (resolved outside the project, or not yet walked) still falls back to
 * reading and parsing it here, which is what the whole function did before.
 *
 * `undefined` for a file that cannot be read or does not parse — a partial whose structure
 * is unknown is what the caller already treats as "no type".
 */
async function readLiquidFile(
  uri: string,
  fs: AbstractFileSystem | undefined,
  app: App | undefined,
): Promise<{ source: string; ast: LiquidHtmlNode } | undefined> {
  const file = await loadedAppFile(uri, app);
  if (file) {
    const { ast, loadedSource } = file;
    if (loadedSource !== undefined && isLiquidDocument(ast)) return { source: loadedSource, ast };
  }

  const source = await readSource(uri, fs, app);
  if (source === undefined) return undefined;

  try {
    return { source, ast: toLiquidHtmlAST(source) };
  } catch {
    return undefined;
  }
}

/**
 * The `App`'s file for `uri`, its `load()` already awaited — the one prologue every read
 * below shares, so none of them spells it a second time and they cannot come to disagree.
 *
 * A failed load leaves the file unread and unparsed rather than throwing out of here; the
 * caller's filesystem fallback is then the second chance.
 */
async function loadedAppFile(uri: string, app: App | undefined): Promise<AppFile | undefined> {
  const file = app?.get(uri);
  if (!file) return undefined;

  await file.load().catch(() => undefined);
  return file;
}

/**
 * A file's text, BUFFER FIRST: the `App`'s copy when it has one, the filesystem otherwise.
 * ONE spelling of that rule for this whole module. `undefined` when neither can produce it.
 */
async function readSource(
  uri: string,
  fs: AbstractFileSystem | undefined,
  app: App | undefined,
): Promise<string | undefined> {
  const file = await loadedAppFile(uri, app);
  if (file?.loadedSource !== undefined) return file.loadedSource;

  if (!fs) return undefined;
  try {
    return await fs.readFile(uri);
  } catch {
    return undefined;
  }
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

    // A documented object is a TYPE, not a shape. Flattening `context` or a `current_user`
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
