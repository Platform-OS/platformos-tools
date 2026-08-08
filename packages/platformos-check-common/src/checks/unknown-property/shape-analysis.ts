import {
  AssignMarkup,
  ComplexLiquidExpression,
  ForMarkup,
  FunctionMarkup,
  GraphQLInlineMarkup,
  GraphQLMarkup,
  HashAssignMarkup,
  JsonArrayLiteral,
  JsonHashLiteral,
  LiquidArgument,
  LiquidExpression,
  LiquidFilter,
  LiquidHtmlNode,
  LiquidNamedArgument,
  LiquidString,
  LiquidTag,
  LiquidVariable,
  LiquidVariableLookup,
  NamedTags,
  NodeTypes,
  TextNode,
} from '@platformos/liquid-html-parser';
import { GraphQLDocumentNode, parseGraphql } from '@platformos/platformos-common';
import { SourceCodeType } from '../../types';
import { visit } from '../../visitor';
import { createBoundedCache } from '../../utils/bounded-cache';
import { extractUndefinedVariables } from '../partial-call-arguments/extract-undefined-variables';
import { isNullLiteral } from '../../liquid-doc/utils';
import { navigationFilter } from '../../filter-semantics';
import {
  ConditionValue,
  NIL_SHAPE,
  PropertyShape,
  UNKNOWN_SHAPE,
  inferShapeFromGraphQL,
  inferShapeFromJSONString,
  deepOpen,
  foldAlternatives,
  objectShape,
  lookupPropertyPath,
  mergeAlternatives,
  mergeShapeAtPath,
  primitiveShapeOfLiteral,
} from './property-shape';

/** How many `{% function %}` boundaries one analysis may cross. */
const MAX_CALL_DEPTH = 3;

/** Tags that assign a variable, so unreadable markup on one means an unknown assignment. */
const ASSIGNING_TAGS = new Set<string>([
  NamedTags.assign,
  NamedTags.hash_assign,
  NamedTags.function,
  NamedTags.graphql,
  NamedTags.parse_json,
  NamedTags.capture,
  // A loop binds its variable, so unreadable markup may bind a name we track.
  NamedTags.for,
  NamedTags.tablerow,
]);

/** Filters a `parse_json` chain may contain and still describe the literal it parses. */
const JSON_CHAIN_FILTERS = new Set(['parse_json', 'to_hash', 'default']);

/** Anything that can appear where a value is expected, with or without filters. */
type ValueExpression = ComplexLiquidExpression | LiquidVariable;

/** How many partial analyses to keep: one per distinct (partial, arguments) pair. */
const RETURN_SHAPE_CACHE_LIMIT = 512;

/** A liquid file the analyzer can read: its identity, its content and its parse. */
export interface AnalyzableFile {
  uri: string;
  source: string;
  ast: LiquidHtmlNode;
}

export interface ShapeAnalyzerDeps {
  /** The `.graphql` document a name refers to, PARSED — the parse the host already has. */
  readGraphQL(name: string): Promise<{ uri: string; ast: GraphQLDocumentNode } | undefined>;
  /** The partial a `{% function x = 'name' %}` calls. */
  readPartial(name: string): Promise<AnalyzableFile | undefined>;
  /** What `uri` holds NOW, for revalidating a memoized analysis. */
  readContent(uri: string): Promise<string | undefined>;
  /** The platformOS GraphQL SDL, or `undefined` when the docset has none. */
  getSchema(): Promise<string | undefined>;
  /**
   * A read this analysis cannot resolve itself — a documented global like
   * `context.current_user`. The language server passes one; a check passes nothing.
   */
  resolveExternalShape?(read: LiquidVariableLookup, position: number): PropertyShape | undefined;
}

/** What a call site proved about one argument. Absent fields mean "not proven". */
export interface Binding {
  shape?: PropertyShape;
  boolean?: boolean;
}

export interface AnalyzerOptions {
  /** Initial variables — a callee's parameters, bound from the call site. */
  bindings?: ReadonlyMap<string, Binding>;
  /** How many more `{% function %}` boundaries may be crossed. */
  depth?: number;
  /** Partials already open on this call chain, by URI. Re-entry claims nothing. */
  callChain?: ReadonlySet<string>;
  /** Variables this source uses and nothing defines — nil at runtime. Callees only. */
  provablyNil?: ReadonlySet<string>;
  /** Every file this analysis reads, and what it read. Filled in as it goes. */
  reads?: Map<string, string>;
}

export interface ShapeAnalyzer {
  /** Feed one `LiquidTag`. Safe to call from a check's visitor or from `visit`. */
  handleLiquidTag(node: LiquidTag, ancestors: LiquidHtmlNode[]): Promise<void>;
  /** Feed one `VariableLookup`; collects the reads that are worth validating. */
  handleVariableLookup(node: LiquidVariableLookup, ancestors: LiquidHtmlNode[]): void;
  /** The property reads collected so far, in source order. */
  readonly lookups: LiquidVariableLookup[];
  /** The shape `name` is known to have at `position`, if any. */
  shapeAt(name: string, position: number): PropertyShape | undefined;
  /** The shape this source `{% return %}`s, if every branch agrees on one. */
  returnShape(): PropertyShape | undefined;
}

interface TrackedValue {
  name: string;
  /** The known structure, or `undefined` for "this check does not know". */
  shape?: PropertyShape;
  /** A provable `true`/`false`, for forwarding into a GraphQL `@include`. */
  boolean?: boolean;
  range: [start: number, end?: number];
  /** A REFERENCE to a value tracked elsewhere, so a write through it lands off-model. */
  alias?: true;
}

/** A write to a variable, resolved out of whichever tag spelled it. */
interface Write {
  name: string;
  /** The lvalue path: `[]` for a plain write, `undefined` when it is dynamic. */
  path: string[] | undefined;
  operator: '=' | '<<';
  /** The written value's structure, `undefined` when unknown. */
  valueShape: PropertyShape | undefined;
  /** The written value as a provable boolean, for plain writes. */
  boolean?: boolean;
  /** Where the previous value stops being current and the new one starts. */
  at: number;
  /** The end of the conditional branch the write sits in: past it, the write is no fact. */
  scopeEnd?: number;
}

/**
 * Whether a write goes THROUGH the name rather than TO it — including a dynamic key,
 * which is still a write into `x` rather than a replacement of it.
 */
function isWriteThroughName(path: string[] | undefined, operator: Write['operator']): boolean {
  return path === undefined || path.length > 0 || operator === '<<';
}

export function createShapeAnalyzer(
  deps: ShapeAnalyzerDeps,
  options: AnalyzerOptions = {},
): ShapeAnalyzer {
  const depth = options.depth ?? MAX_CALL_DEPTH;
  const callChain = options.callChain ?? new Set<string>();
  const provablyNil = options.provablyNil ?? new Set<string>();
  const reads = options.reads;

  const values: TrackedValue[] = [];
  const lookups: LiquidVariableLookup[] = [];
  const returnShapes: PropertyShape[] = [];
  /** A `{% return %}` whose value we could not resolve: the callee's shape is unknowable. */
  let returnsUnresolvable = false;
  /** A write this model could not record — an alias, a loop item, a dynamic key. */
  let mutatedBeyondModel = false;

  // A callee's parameters are in scope from before its first line, so `-1`.
  for (const [name, binding] of options.bindings ?? []) {
    values.push({ name, shape: binding.shape, boolean: binding.boolean, range: [-1] });
  }

  const valueAt = (name: string, position: number): TrackedValue | undefined => {
    let found: TrackedValue | undefined;
    for (const value of values) {
      if (value.name !== name) continue;
      const [start, end] = value.range;
      if (position <= start) continue;
      if (end !== undefined && position > end) continue;
      found = value;
    }
    return found;
  };

  const shapeAt = (name: string, position: number) => valueAt(name, position)?.shape;

  /** Forget every shape: something happened that we cannot attribute to a variable. */
  const closeEverything = (endPosition: number) => {
    for (const value of values) {
      if (value.range[1] === undefined) value.range[1] = endPosition;
    }
    mutatedBeyondModel = true;
  };

  const closeRange = (name: string, endPosition: number) => {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i].name === name && values[i].range[1] === undefined) {
        values[i].range[1] = endPosition;
        break;
      }
    }
  };

  const applyWrite = (write: Write) => {
    const previousValue = valueAt(write.name, write.at);
    const previous = previousValue?.shape;
    closeRange(write.name, write.at);

    const throughName = isWriteThroughName(write.path, write.operator);

    // A write we cannot place still happened, so the return may carry unseen fields.
    if (
      write.path === undefined ||
      (write.path.length > 0 && !previous) ||
      (throughName && previousValue?.alias)
    ) {
      mutatedBeyondModel = true;
    }

    values.push({
      name: write.name,
      shape: writtenShape(write, previous),
      boolean: write.boolean,
      range: [write.at, write.scopeEnd],
      // Still the same reference: writing one key does not make the name local.
      alias: throughName ? previousValue?.alias : undefined,
    });

    // Past the branch, nobody knows whether the write ran.
    if (write.scopeEnd !== undefined) {
      values.push({ name: write.name, range: [write.scopeEnd] });
    }
  };

  /**
   * Bind a loop variable over the BODY. The name it binds shadows whatever that name
   * held, and Liquid scopes it, so past `{% endfor %}` the name means what it did before.
   */
  const bindLoopVariable = (node: LiquidTag & { markup: ForMarkup }) => {
    const name = node.markup.variableName;
    if (!name) return;

    const bodyStart = node.blockStartPosition.end;
    const bodyEnd = node.blockEndPosition?.start;
    const outer = valueAt(name, bodyStart);

    closeRange(name, bodyStart);
    values.push({
      name,
      shape: iteratedItemShape(node.markup.collection, bodyStart),
      range: [bodyStart, bodyEnd],
      alias: true,
    });

    // The loop variable goes out of scope; the outer value comes back with it.
    if (bodyEnd !== undefined) {
      values.push({
        name,
        shape: outer?.shape,
        boolean: outer?.boolean,
        range: [bodyEnd],
        alias: outer?.alias,
      });
    }
  };

  /**
   * ONE ITEM of an iterated value. Only a list with a known item shape says anything: a
   * hash iterates as pairs, a range as numbers, a filter-built collection is opaque.
   */
  const iteratedItemShape = (
    collection: LiquidExpression,
    position: number,
  ): PropertyShape | undefined => {
    if (collection.type !== NodeTypes.VariableLookup) return undefined;
    const shape = resolveShape(collection, [], position);
    return shape?.kind === 'array' ? shape.itemShape : undefined;
  };

  /** The shape of a value expression, or `undefined` when the check cannot see into it. */
  const resolveShape = (
    expression: ValueExpression,
    filters: LiquidFilter[],
    position: number,
  ): PropertyShape | undefined => {
    // {% assign x = '{"a": 5}' | parse_json %}
    if (filters.some((filter) => filter.name === 'parse_json' || filter.name === 'to_hash')) {
      if (!filters.every((filter) => JSON_CHAIN_FILTERS.has(filter.name))) return undefined;
      // The literal being parsed, and nothing else: a `| default:` fallback is an
      // alternative, describing the value only in the branch where the expression is nil.
      if (expression.type !== NodeTypes.String) return undefined;
      return inferShapeFromJSONString(expression.value);
    }

    // {% assign x = {a: 5} %} / {% assign x = [1, 2] %}
    if (
      expression.type === NodeTypes.JsonHashLiteral ||
      expression.type === NodeTypes.JsonArrayLiteral
    ) {
      return filters.length > 0 ? undefined : literalShape(expression, position);
    }

    // {% assign x = y.a %} / {% assign x = y | dig: 'a', 'b' %} / {% assign x = y | fetch: 'a' %}
    if (expression.type === NodeTypes.VariableLookup && expression.name) {
      // Cheap test first: resolving the read can reach the host's whole type system.
      if (!filters.every((filter) => navigationFilter(filter.name))) return undefined;
      const read = readShape(expression, position);
      if (!read) return undefined;
      return applyNavigationFilters(read, filters);
    }

    return undefined;
  };

  /**
   * The shape of a whole `a.b.c` read: what this analysis tracked for `a`, or — for a
   * name it never saw assigned — whatever the host knows about it.
   */
  const readShape = (read: LiquidVariableLookup, position: number): PropertyShape | undefined => {
    const base = read.name ? shapeAt(read.name, position) : undefined;
    if (!base) return deps.resolveExternalShape?.(read, position);

    const path = buildLookupPath(read.lookups);
    if (!path) return undefined;
    const result = lookupPropertyPath(base, path);
    return result.error ? undefined : result.shape;
  };

  const literalShape = (
    node: JsonHashLiteral | JsonArrayLiteral,
    position: number,
  ): PropertyShape => {
    if (node.type === NodeTypes.JsonArrayLiteral) {
      const items = node.elements.map((element) => entryShape(element, position));
      return { kind: 'array', itemShape: foldAlternatives(items) };
    }

    const properties = new Map<string, PropertyShape>();
    for (const entry of node.entries) {
      // Keys are VariableLookup nodes (bare keys) or String nodes (quoted keys)
      const keyName =
        entry.key.type === NodeTypes.VariableLookup
          ? (entry.key.name ?? undefined)
          : entry.key.type === NodeTypes.String
            ? entry.key.value
            : undefined;
      if (keyName !== undefined) {
        properties.set(keyName, entryShape(entry.value, position));
      }
    }
    return objectShape(properties);
  };

  /**
   * A value written THROUGH a name, where a literal is worth taking at face value —
   * the claim is about the list's ITEMS or ONE KEY, not about the name itself.
   * `{% assign x = 'text' %}` claims nothing, because Liquid answers nil for `x.foo`.
   */
  const writtenValueShape = (
    expression: ValueExpression,
    filters: LiquidFilter[],
    position: number,
    throughName: boolean,
  ): PropertyShape | undefined => {
    const resolved = resolveShape(expression, filters, position);
    if (resolved || !throughName || filters.length > 0) return resolved;
    return entryShape(expression, position);
  };

  const entryShape = (node: ValueExpression, position: number): PropertyShape => {
    if (
      node.type === NodeTypes.JsonHashLiteral ||
      node.type === NodeTypes.JsonArrayLiteral ||
      node.type === NodeTypes.VariableLookup
    ) {
      return resolveShape(node, [], position) ?? UNKNOWN_SHAPE;
    }
    if (node.type === NodeTypes.String) return { kind: 'primitive', primitiveType: 'string' };
    if (node.type === NodeTypes.Number) return { kind: 'primitive', primitiveType: 'number' };
    // A `nil` reached through a `{% liquid %}` variable wrapper is still a nil.
    if (isNullLiteral(node)) return NIL_SHAPE;
    if (node.type === NodeTypes.LiquidLiteral) return primitiveShapeOfLiteral(node.value);
    return UNKNOWN_SHAPE;
  };

  /** A provable `true`/`false`, or `'unknown'`. Never a guess. */
  const resolveCondition = (
    expression: ValueExpression,
    filters: LiquidFilter[],
    position: number,
  ): ConditionValue => {
    if (filters.length > 0) return 'unknown';
    if (expression.type === NodeTypes.LiquidLiteral) {
      return typeof expression.value === 'boolean' ? expression.value : 'unknown';
    }
    if (
      expression.type === NodeTypes.VariableLookup &&
      expression.name &&
      expression.lookups.length === 0
    ) {
      const tracked = valueAt(expression.name, position);
      if (tracked?.boolean !== undefined) return tracked.boolean;
      // Nil neither satisfies an `@include` nor triggers a `@skip`, exactly as false.
      if (!tracked && provablyNil.has(expression.name)) return false;
      return 'unknown';
    }
    return 'unknown';
  };

  const pushGraphQLShape = (
    name: string,
    document: GraphQLDocumentNode | undefined,
    filters: LiquidFilter[],
    args: LiquidNamedArgument[],
    at: number,
    scopeEnd: number | undefined,
    schema: string | undefined,
  ) => {
    // The tag reassigned the variable even when its document is unreadable.
    const shape =
      document === undefined
        ? undefined
        : inferShapeFromGraphQL(document, schema, resolveArgumentConditions(args, at));
    applyWrite({
      name,
      path: [],
      operator: '=',
      valueShape: shape ? applyNavigationFilters(shape, filters) : undefined,
      at,
      scopeEnd,
    });
  };

  const resolveArgumentConditions = (args: LiquidNamedArgument[], position: number) => {
    const conditions = new Map<string, ConditionValue>();
    for (const arg of args) {
      const { expression, filters } = unwrapArgumentValue(arg.value);
      conditions.set(
        arg.name,
        expression === undefined ? 'unknown' : resolveCondition(expression, filters, position),
      );
    }
    return conditions;
  };

  const resolveBindings = (args: LiquidNamedArgument[], position: number) => {
    const bindings = new Map<string, Binding>();
    for (const arg of args) {
      const { expression, filters } = unwrapArgumentValue(arg.value);
      if (expression === undefined) {
        bindings.set(arg.name, {});
        continue;
      }
      const condition = resolveCondition(expression, filters, position);
      bindings.set(arg.name, {
        shape: resolveShape(expression, filters, position),
        boolean: condition === 'unknown' ? undefined : condition,
      });
    }
    return bindings;
  };

  /**
   * The shape a `{% function %}` call returns. `undefined` for anything unproven;
   * `MissingPartial` owns "this partial does not exist".
   */
  const resolveFunctionReturn = async (
    partialName: string,
    args: LiquidNamedArgument[],
    position: number,
  ): Promise<PropertyShape | undefined> => {
    if (depth <= 0) return undefined;

    const partial = await deps.readPartial(partialName);
    if (!partial) return undefined;
    if (reads) reads.set(partial.uri, partial.source);
    if (callChain.has(partial.uri)) return undefined;

    const bindings = resolveBindings(args, position);
    const analysis = await analyzePartial(partial, bindings, deps, {
      depth: depth - 1,
      callChain: new Set(callChain).add(partial.uri),
    });

    // The callee's reads become ours, so one revalidation covers the whole chain.
    if (reads) for (const [uri, content] of analysis.reads) reads.set(uri, content);

    return analysis.shape;
  };

  const handleLiquidTag = async (
    node: LiquidTag,
    ancestors: LiquidHtmlNode[] = [],
  ): Promise<void> => {
    // A read INSIDE the tag still resolves against the previous value.
    const at = node.blockEndPosition?.end ?? node.position.end;
    const scopeEnd = enclosingBranchEnd(ancestors);

    // Unreadable markup may have assigned anything; `LiquidHTMLSyntaxError` owns saying so.
    if (typeof node.markup === 'string' && ASSIGNING_TAGS.has(node.name)) {
      closeEverything(at);
      return;
    }

    // The only tag that assigns a structure this check does not model. `increment` and
    // `decrement` are NOT here: they write to a counter namespace an assigned variable
    // shadows, so they change nothing this analyzer tracks.
    if (node.name === NamedTags.capture && typeof node.markup !== 'string') {
      const target = node.markup as LiquidVariableLookup;
      if (target.name) {
        applyWrite({
          name: target.name,
          path: [],
          operator: '=',
          valueShape: undefined,
          at,
          scopeEnd,
        });
      }
      return;
    }

    // {% for item in collection %} / {% tablerow item in collection %}
    if (isLiquidTagLoop(node)) {
      bindLoopVariable(node);
      return;
    }

    // {% assign x = value %} / {% assign x['key'] = value %} / {% assign x << value %}
    if (isLiquidTagAssign(node)) {
      const markup = node.markup;
      const path = buildLookupPath(markup.lookups);
      applyWrite({
        name: markup.name,
        path,
        operator: markup.operator,
        valueShape: writtenValueShape(
          markup.value.expression,
          markup.value.filters ?? [],
          at,
          isWriteThroughName(path, markup.operator),
        ),
        boolean: booleanOf(
          resolveCondition(markup.value.expression, markup.value.filters ?? [], at),
        ),
        at,
        scopeEnd,
      });
      return;
    }

    // {% parse_json x %}{"a": 5}{% endparse_json %}
    if (isLiquidTagParseJson(node)) {
      const name = node.markup.name;
      if (!name) return;
      applyWrite({
        name,
        path: [],
        operator: '=',
        // Only an all-text body is the document that runs: dropping an interpolation
        // leaves a DIFFERENT document that a tolerant parser still reads.
        valueShape: isPlainTextBlock(node)
          ? inferShapeFromJSONString(textContentOf(node))
          : undefined,
        at,
        scopeEnd,
      });
      return;
    }

    // {% graphql result = 'query_name', arg: value %} (file-based)
    if (isLiquidTagGraphQL(node) && isGraphQLMarkup(node.markup)) {
      const markup = node.markup;
      const graphqlFile = isLiquidString(markup.graphql) ? markup.graphql.value : undefined;
      const document = graphqlFile ? await deps.readGraphQL(graphqlFile) : undefined;
      if (document && reads) reads.set(document.uri, document.ast.content);

      pushGraphQLShape(
        markup.name,
        document?.ast,
        markup.filters,
        markup.args,
        at,
        scopeEnd,
        // Only the arm that has a document reads the schema, and fetching it is not free.
        document ? await deps.getSchema() : undefined,
      );
      return;
    }

    // {% graphql result, arg: value %}…inline…{% endgraphql %}
    if (isLiquidTagGraphQL(node) && isGraphQLInlineMarkup(node.markup)) {
      const markup = node.markup;
      // No file holds an inline body's parse, so it is parsed here. All-text only, for
      // the reason `{% parse_json %}` states above.
      const document = isPlainTextBlock(node) ? parseGraphql(textContentOf(node)) : undefined;
      pushGraphQLShape(
        markup.name,
        document,
        markup.filters,
        markup.args,
        at,
        scopeEnd,
        document ? await deps.getSchema() : undefined,
      );
      return;
    }

    // {% function x = 'partial', arg: value %} / {% function x['key'] = 'partial' %}
    if (isLiquidTagFunction(node)) {
      const markup = node.markup;
      const name = markup.name.name;
      if (!name) return;

      const partialName = isLiquidString(markup.partial) ? markup.partial.value : undefined;
      // A filter on the result transforms it into something we cannot see.
      const returned =
        partialName && markup.filters.length === 0
          ? await resolveFunctionReturn(partialName, markup.args, at)
          : undefined;

      applyWrite({
        name,
        path: buildLookupPath(markup.name.lookups),
        operator: '=',
        valueShape: returned,
        at,
        scopeEnd,
      });
      return;
    }

    // {% hash_assign x['key'] = value %}
    if (isLiquidTagHashAssign(node)) {
      const markup = node.markup;
      const name = markup.target.name;
      if (!name) return;
      applyWrite({
        name,
        path: buildLookupPath(markup.target.lookups),
        operator: '=',
        valueShape: writtenValueShape(
          markup.value.expression,
          markup.value.filters ?? [],
          at,
          true,
        ),
        at,
        scopeEnd,
      });
      return;
    }

    // {% return value %} — what a `{% function %}` call site receives.
    if (isLiquidTagReturn(node)) {
      const markup = node.markup;
      if (markup === null) return;
      // A `nil` return neither contributes nor poisons.
      if (isNullLiteral(markup.expression)) return;

      const shape = resolveShape(markup.expression, markup.filters ?? [], node.position.start);
      if (shape) returnShapes.push(shape);
      else returnsUnresolvable = true;
    }
  };

  const handleVariableLookup = (node: LiquidVariableLookup, ancestors: LiquidHtmlNode[]) => {
    if (node.lookups.length === 0) return;

    // The target of a write is being DEFINED, not read.
    const parent = ancestors[ancestors.length - 1];
    if (isWriteTarget(parent, node)) return;

    lookups.push(node);
  };

  const returnShape = (): PropertyShape | undefined => {
    if (returnsUnresolvable || returnShapes.length === 0) return undefined;
    // The branches are ALTERNATIVES: exactly one of them ran.
    const merged = returnShapes.reduce(mergeAlternatives);
    if (merged.kind === 'unknown') return undefined;
    return mutatedBeyondModel ? deepOpen(merged) : merged;
  };

  return { handleLiquidTag, handleVariableLookup, lookups, shapeAt, returnShape };
}

function writtenShape(write: Write, previous: PropertyShape | undefined) {
  // A dynamic lvalue (`{% hash_assign x[key] = v %}`) writes we-know-not-where.
  if (write.path === undefined) return undefined;

  if (write.path.length === 0) {
    if (write.operator === '=') return write.valueShape;
    // Only a base already known to be an array can be narrowed by a push.
    if (previous?.kind !== 'array') return undefined;
    // The pushed element and the ones already there are ALTERNATIVES.
    const item = write.valueShape ?? UNKNOWN_SHAPE;
    return {
      kind: 'array' as const,
      itemShape: previous.itemShape ? mergeAlternatives(previous.itemShape, item) : item,
    };
  }

  // A push at a path: the key is known to exist, its contents are not.
  const valueShape = write.operator === '<<' ? UNKNOWN_SHAPE : (write.valueShape ?? UNKNOWN_SHAPE);

  // With no base the write is the only evidence, and it proves "a hash with AT LEAST
  // this key" — which is what `open` says. A closed shape would claim it has only that key.
  if (!previous) return openShapeAtPath(write.path, valueShape);

  return mergeShapeAtPath(previous, write.path, valueShape);
}

/** `{ path: value }`, open at every level the path passes through. */
function openShapeAtPath(path: string[], valueShape: PropertyShape): PropertyShape {
  const [key, ...rest] = path;
  const value = rest.length === 0 ? valueShape : openShapeAtPath(rest, valueShape);
  return { kind: 'object', properties: new Map([[key, value]]), open: true };
}

interface PartialAnalysis {
  shape: PropertyShape | undefined;
  /** Every file the analysis read, and the content it read, transitively. */
  reads: Map<string, string>;
}

interface CacheEntry {
  analysis: Promise<PartialAnalysis>;
}

/**
 * Memoized partial analyses. An entry records every file the analysis READ, and a hit is
 * revalidated against their current contents before it is trusted.
 */
const analysisCache = createBoundedCache<CacheEntry>(RETURN_SHAPE_CACHE_LIMIT);

async function analyzePartial(
  partial: AnalyzableFile,
  bindings: ReadonlyMap<string, Binding>,
  deps: ShapeAnalyzerDeps,
  options: { depth: number; callChain: ReadonlySet<string> },
): Promise<PartialAnalysis> {
  // Identity only, NOT the partial's text: `isStale` re-reads what the analysis touched
  // on every hit, which makes it load-bearing rather than belt-and-braces.
  const key = [partial.uri, bindingsKey(bindings)].join('\0');
  const run = () => runPartialAnalysis(partial, bindings, deps, options);

  let computed = false;
  const entry = analysisCache(key, () => {
    computed = true;
    return { analysis: run() };
  });

  const analysis = await entry.analysis;
  // What this call computed cannot be stale; only a hit needs its reads checked.
  if (computed || !(await isStale(analysis, deps))) return analysis;

  entry.analysis = run();
  return entry.analysis;
}

async function runPartialAnalysis(
  partial: AnalyzableFile,
  bindings: ReadonlyMap<string, Binding>,
  deps: ShapeAnalyzerDeps,
  options: { depth: number; callChain: ReadonlySet<string> },
): Promise<PartialAnalysis> {
  const reads = new Map<string, string>([[partial.uri, partial.source]]);
  // A parameter the call site did not pass and the partial never assigns holds nil.
  // `extractUndefinedVariables` sees definitions this analyzer does not track.
  const provablyNil = new Set(
    extractUndefinedVariables(partial.source).required.filter((name) => !bindings.has(name)),
  );
  const analyzer = createShapeAnalyzer(deps, { ...options, bindings, provablyNil, reads });

  // Only the tags: the callee's own reads are reported when it is linted as a file.
  await visit<SourceCodeType.LiquidHtml, void>(partial.ast, {
    async LiquidTag(node, ancestors) {
      await analyzer.handleLiquidTag(node, ancestors);
    },
  });

  return { shape: analyzer.returnShape(), reads };
}

/** Runs on every cache HIT, so the reads overlap rather than queue. */
async function isStale(analysis: PartialAnalysis, deps: ShapeAnalyzerDeps): Promise<boolean> {
  const read = [...analysis.reads];
  const current = await Promise.all(read.map(([uri]) => deps.readContent(uri)));
  return read.some(([, content], i) => current[i] !== content);
}

/** Only what the callee can branch on: a boolean, and the STRUCTURE of a shape. */
function bindingsKey(bindings: ReadonlyMap<string, Binding>): string {
  return [...bindings]
    .map(([name, binding]) => `${name}=${binding.boolean ?? '?'}:${shapeKey(binding.shape)}`)
    .sort()
    .join(',');
}

function shapeKey(shape: PropertyShape | undefined): string {
  if (!shape) return '?';
  if (shape.kind === 'object') {
    const entries = [...(shape.properties ?? [])]
      .map(([key, value]) => `${key}:${shapeKey(value)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  if (shape.kind === 'array') return `[${shapeKey(shape.itemShape)}]`;
  if (shape.kind === 'unknown') return '?';
  return shape.primitiveType ?? 'primitive';
}

/**
 * The navigated shape, the original when there are NO filters, or `undefined` for a
 * dynamic key, a path that leads nowhere, or any filter that transforms.
 */
function applyNavigationFilters(
  shape: PropertyShape,
  filters: LiquidFilter[],
): PropertyShape | undefined {
  let current: PropertyShape | undefined = shape;
  // Hop by hop rather than one flattened path: the hash requirement below is per-filter.
  for (const filter of filters) {
    current = navigateOne(current, filter);
    if (!current) return undefined;
  }
  return current;
}

/** One hop of {@link applyNavigationFilters}, or `undefined` when it describes no value. */
function navigateOne(shape: PropertyShape, filter: LiquidFilter): PropertyShape | undefined {
  const navigates = navigationFilter(filter.name);
  if (!navigates) return undefined;
  // Both no key and one key past the arity raise rather than dig.
  if (filter.args.length === 0 || filter.args.length > navigates.maxKeys) return undefined;

  // The piped input must be a hash — a list raises and the page stops. An array in the
  // MIDDLE of one filter's keys is fine.
  if (shape.kind !== 'object') return undefined;

  const path = buildLookupPath(filter.args);
  if (!path) return undefined;

  const result = lookupPropertyPath(shape, path);
  return result.error || !result.shape ? undefined : result.shape;
}

/**
 * The innermost conditional branch enclosing a write, or `undefined` on the straight-line
 * path. Loop bodies count: a write in a loop that may run zero times is as uncertain.
 */
function enclosingBranchEnd(ancestors: LiquidHtmlNode[]): number | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i].type === NodeTypes.LiquidBranch) return ancestors[i].position.end;
  }
  return undefined;
}

/** The static path a list of lookups or filter arguments spells. */
export function buildLookupPath(lookups: LiquidArgument[]): string[] | undefined {
  const path: string[] = [];

  for (const lookup of lookups) {
    if (lookup.type === NodeTypes.String) {
      path.push(lookup.value);
    } else if (lookup.type === NodeTypes.Number) {
      path.push(String(lookup.value));
    } else {
      // Dynamic lookup (variable), or a named argument - can't validate
      return undefined;
    }
  }

  return path;
}

function isPlainTextBlock(node: LiquidTag & { children?: LiquidHtmlNode[] }): boolean {
  return (node.children ?? []).every((child) => child.type === NodeTypes.TextNode);
}

function textContentOf(node: LiquidTag & { children?: LiquidHtmlNode[] }): string {
  return (node.children ?? [])
    .filter((child): child is TextNode => child.type === NodeTypes.TextNode)
    .map((child) => child.value)
    .join('');
}

function booleanOf(condition: ConditionValue): boolean | undefined {
  return condition === 'unknown' ? undefined : condition;
}

function unwrapArgumentValue(value: LiquidNamedArgument['value']): {
  expression?: ValueExpression;
  filters: LiquidFilter[];
} {
  // A `graphql` argument may carry filters; every other tag's is a bare expression.
  if (value.type === NodeTypes.LiquidVariable) {
    return { expression: value.expression, filters: value.filters ?? [] };
  }
  if (value.type === NodeTypes.NamedArgument) return { filters: [] };
  return { expression: value, filters: [] };
}

function isWriteTarget(parent: LiquidHtmlNode | undefined, node: LiquidVariableLookup): boolean {
  if (!parent || typeof parent !== 'object') return false;
  if (parent.type === NodeTypes.HashAssignMarkup) return parent.target === node;
  if (parent.type === NodeTypes.FunctionMarkup) return parent.name === node;
  return false;
}

// Type guards
function isLiquidTagAssign(node: LiquidTag): node is LiquidTag & { markup: AssignMarkup } {
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

function isLiquidTagFunction(node: LiquidTag): node is LiquidTag & { markup: FunctionMarkup } {
  return node.name === NamedTags.function && typeof node.markup !== 'string';
}

function isLiquidTagHashAssign(node: LiquidTag): node is LiquidTag & { markup: HashAssignMarkup } {
  return node.name === NamedTags.hash_assign && typeof node.markup !== 'string';
}

function isLiquidTagReturn(node: LiquidTag): node is LiquidTag & { markup: LiquidVariable | null } {
  return node.name === NamedTags.return && typeof node.markup !== 'string';
}

/** `{% for %}` and `{% tablerow %}` — one markup, one binding rule. */
function isLiquidTagLoop(node: LiquidTag): node is LiquidTag & { markup: ForMarkup } {
  return (
    (node.name === NamedTags.for || node.name === NamedTags.tablerow) &&
    typeof node.markup !== 'string' &&
    node.markup.type === NodeTypes.ForMarkup
  );
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
