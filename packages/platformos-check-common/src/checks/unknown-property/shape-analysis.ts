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
import {
  ConditionValue,
  PropertyShape,
  UNKNOWN_SHAPE,
  inferShapeFromGraphQL,
  inferShapeFromJSONString,
  deepOpen,
  objectShape,
  lookupPropertyPath,
  mergeShapeAtPath,
  mergeShapes,
} from './property-shape';

/**
 * How many `{% function %}` boundaries one analysis may cross. Three covers the
 * platformOS convention of page → command → query partial → `.graphql`; beyond that
 * the answer is "unknown shape", never a partial one.
 */
const MAX_CALL_DEPTH = 3;

/** Tags that assign a variable, so unreadable markup on one means an unknown assignment. */
const ASSIGNING_TAGS = new Set<string>([
  NamedTags.assign,
  NamedTags.hash_assign,
  NamedTags.function,
  NamedTags.graphql,
  NamedTags.parse_json,
  NamedTags.capture,
  // A loop binds its variable, and markup we cannot read may bind a name we are
  // tracking — which is the shadowing this check used to get wrong even when it COULD
  // read the markup.
  NamedTags.for,
  NamedTags.tablerow,
]);

/** Tags that assign a value whose structure this check does not model. */
const UNMODELLED_ASSIGNMENTS = new Set<string>([
  NamedTags.capture,
  NamedTags.increment,
  NamedTags.decrement,
]);

/** Filters that leave a JSON string's shape intact, so the shape can still be claimed. */
const JSON_SHAPE_FILTERS = new Set(['parse_json', 'to_hash', 'default']);

/** Anything that can appear where a value is expected, with or without filters. */
type ValueExpression = ComplexLiquidExpression | LiquidVariable;

/**
 * How many partial analyses to keep. A lint run asks one question per DISTINCT
 * (partial, arguments) pair, so this covers a whole project while bounding what a
 * long-lived process retains. Values are one shape plus the read log that validates
 * it; the keys hold partial sources, which is what the cap is really sizing.
 */
const RETURN_SHAPE_CACHE_LIMIT = 512;

/** A liquid file the analyzer can read: its identity, its content and its parse. */
export interface AnalyzableFile {
  uri: string;
  source: string;
  ast: LiquidHtmlNode;
}

export interface ShapeAnalyzerDeps {
  /**
   * The `.graphql` document a `{% graphql x = 'name' %}` names, PARSED — the parse the
   * host already has (an `AppFile`'s), so a query named from thirty call sites costs
   * one parse. `ast.content` is the source, so there is nothing to keep in step.
   */
  readGraphQL(name: string): Promise<{ uri: string; ast: GraphQLDocumentNode } | undefined>;
  /** The partial a `{% function x = 'name' %}` calls. */
  readPartial(name: string): Promise<AnalyzableFile | undefined>;
  /** What `uri` holds NOW, for revalidating a memoized analysis. */
  readContent(uri: string): Promise<string | undefined>;
  /** The platformOS GraphQL SDL, or `undefined` when the docset has none. */
  getSchema(): Promise<string | undefined>;
  /**
   * The shape of a read this analysis cannot resolve itself — a documented global like
   * `context.current_user`, whose properties come from the docset rather than from any
   * assignment in the file.
   *
   * The seam exists for the language server, which knows those and needs them inside a
   * hash literal (`{ "user": context.current_user }`) for hover and completion. A check
   * passes nothing and gets exactly the answers it got before.
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
  /**
   * Variables this source uses and nothing ever defines — nil at runtime. Only a
   * callee has these: it is the call site that decides whether a parameter it never
   * assigns has a value at all.
   */
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
  /**
   * This name is a REFERENCE to a value tracked elsewhere — a `for`/`tablerow` item is
   * an element of the collection, not a copy of it. Liquid hands out references, so a
   * write through it lands somewhere this model cannot name, which is what makes a
   * partial that does so return {@link deepOpen}.
   */
  alias?: true;
}

/**
 * A write to a variable, resolved out of whichever tag spelled it.
 *
 * `assign`, `hash_assign` and `function` all write through an optional LVALUE PATH
 * (`{% assign hash['key'] = … %}`, `{% function hash['key'] = 'partial' %}`), and
 * `assign` also has the `<<` push operator. Keying on `name` alone — as every handler
 * used to — turns a write to one key into a claim about the whole variable.
 */
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
  /**
   * The end of the conditional branch the write sits in, if any. A write only one
   * BRANCH performs is not a fact about the code after it — nor about a sibling branch,
   * which is where `{% if a %}{% assign orders = orders.results %}{% elsif b %}` used to
   * report `orders.results` as an unknown property.
   */
  scopeEnd?: number;
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

    // A write THROUGH the name rather than TO it: `{% assign x['k'] = v %}`,
    // `{% hash_assign x['k'] = v %}`, `{% assign x << v %}`.
    const throughName =
      write.path === undefined || write.path.length > 0 || write.operator === '<<';

    // A write we cannot place — through an alias, a loop item, a dynamic key — still
    // happened. Whatever this source returns may carry fields we never saw assigned.
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
      // Still the same reference: writing one key of a loop item does not make the
      // name mean something local.
      alias: throughName ? previousValue?.alias : undefined,
    });

    // Past the branch, nobody knows whether the write ran.
    if (write.scopeEnd !== undefined) {
      values.push({ name: write.name, range: [write.scopeEnd] });
    }
  };

  /**
   * Bind a `for`/`tablerow` loop variable over the loop's BODY.
   *
   * `for` is a write, and the name it binds SHADOWS whatever that name held: after
   * `graphql r = 'audience'`, `for r in grouped['followship:tag']` makes `r` an item of
   * an opaque collection for the length of the body, so `r.l_id` is unverifiable —
   * before this, every property of the ITEM was checked against the shape of the
   * COLLECTION's source and reported as unknown.
   *
   * Liquid pushes a scope for the loop variable, so past `{% endfor %}` the name means
   * again exactly what it meant before the loop.
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
   * The shape of ONE ITEM of an iterated value, or `undefined` when unknowable.
   *
   * Only a list whose item shape is known says anything: a hash iterates as
   * `[key, value]` pairs, a range as numbers, and a collection built by a filter
   * (`| group_by:`, then indexed by key) is opaque — so those bind nothing rather than
   * pass the collection's own shape off as the item's.
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
    // {% assign x = '{"a": 5}' | parse_json %} — including the `| default: '{…}'` fallback
    if (filters.some((filter) => filter.name === 'parse_json' || filter.name === 'to_hash')) {
      // Only while every filter in the chain is one we can see through. A
      // `| hash_merge:` after the `parse_json` adds keys the JSON string does not have,
      // and claiming the string's shape anyway reported every one of them as unknown.
      if (!filters.every((filter) => JSON_SHAPE_FILTERS.has(filter.name))) return undefined;
      const json = jsonStringFrom(expression, filters);
      return json === undefined ? undefined : inferShapeFromJSONString(json);
    }

    // {% assign x = {a: 5} %} / {% assign x = [1, 2] %}
    if (
      expression.type === NodeTypes.JsonHashLiteral ||
      expression.type === NodeTypes.JsonArrayLiteral
    ) {
      return filters.length > 0 ? undefined : literalShape(expression, position);
    }

    // {% assign x = y.a %} / {% assign x = y | dig: 'a' %}
    if (expression.type === NodeTypes.VariableLookup && expression.name) {
      const digPath = digPathOf(filters);
      if (!digPath) return undefined;
      const read = readShape(expression, position);
      if (!read) return undefined;
      if (digPath.length === 0) return read;
      const result = lookupPropertyPath(read, digPath);
      return result.error || !result.shape ? undefined : result.shape;
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
      let itemShape: PropertyShape | undefined;
      for (const element of node.elements) {
        const elementShape = entryShape(element, position);
        itemShape = itemShape ? mergeShapes(itemShape, elementShape) : elementShape;
      }
      return { kind: 'array', itemShape };
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
   * The shape of a value being written THROUGH a name — pushed onto a list, or set at a
   * key — where a literal is worth taking at face value.
   *
   * `{% assign x = 'text' %}` claims nothing: naming a string as one would turn every
   * `x.foo` in a project into an offense, and Liquid answers nil there rather than
   * failing. `{% assign list << 'text' %}` is different: the claim is about the list's
   * ITEMS, which is what makes `list.first.foo` wrong and completion useful.
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
    if (node.type === NodeTypes.LiquidLiteral) return { kind: 'primitive' };
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
      // A parameter the call site did not pass and the callee never assigns is nil, and
      // nil can neither satisfy an `@include` nor trigger a `@skip` — it behaves exactly
      // as `false` does for both.
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
    // A document we could not read leaves the variable UNKNOWN rather than untouched: the
    // tag still reassigned it, and the shape it had before is not what it holds now.
    const shape =
      document === undefined
        ? undefined
        : inferShapeFromGraphQL(document, schema, resolveArgumentConditions(args, at));
    applyWrite({
      name,
      path: [],
      operator: '=',
      valueShape: shape ? applyDigFilters(shape, filters) : undefined,
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
   * The shape a `{% function %}` call returns, by analyzing the callee with these
   * arguments bound. `undefined` for anything unproven — a partial that does not
   * resolve, a recursive chain, an exhausted depth budget. `MissingPartial` owns
   * "this partial does not exist".
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
    // The end of the tag: where the previous value stops being current and the new
    // one starts. A read inside the tag (`{% assign a = a.b %}`, `{% function o = 'p',
    // arg: o.c %}`) still resolves against the previous value.
    const at = node.blockEndPosition?.end ?? node.position.end;
    const scopeEnd = enclosingBranchEnd(ancestors);

    // Markup the parser could not read (`{% function o = 'p', current_profile %}`) may
    // have assigned anything, including the variable we are tracking. Keeping the old
    // shape reported the new value's fields as unknown; `LiquidHTMLSyntaxError` owns
    // telling the author about the markup itself.
    if (typeof node.markup === 'string' && ASSIGNING_TAGS.has(node.name)) {
      closeEverything(at);
      return;
    }

    // {% capture x %}…{% endcapture %} / {% increment x %} — assigns a value whose
    // structure this check does not model.
    if (UNMODELLED_ASSIGNMENTS.has(node.name) && typeof node.markup !== 'string') {
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
          path === undefined || path.length > 0 || markup.operator === '<<',
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
        // Only a body that is entirely text is JSON we can read. Interpolate a value
        // into it — `{ "id": {{ object.id | json }} }`, the platformOS way to build
        // JSON — and what is left after dropping the output tags is a DIFFERENT
        // document that a tolerant parser still reads, one key short of the truth.
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
        await deps.getSchema(),
      );
      return;
    }

    // {% graphql result, arg: value %}…inline…{% endgraphql %}
    if (isLiquidTagGraphQL(node) && isGraphQLInlineMarkup(node.markup)) {
      const markup = node.markup;
      pushGraphQLShape(
        markup.name,
        // An inline body has no file, so no `AppFile` holds its parse — the same parser
        // the app injects, called directly on the text between the tags.
        parseGraphql(textContentOf(node)),
        markup.filters,
        markup.args,
        at,
        scopeEnd,
        await deps.getSchema(),
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
      // A `nil` return says nothing about the shape of the value another branch
      // returns, so it neither contributes nor poisons.
      if (isNilExpression(markup.expression)) return;

      const shape = resolveShape(markup.expression, markup.filters ?? [], node.position.start);
      if (shape) returnShapes.push(shape);
      else returnsUnresolvable = true;
    }
  };

  const handleVariableLookup = (node: LiquidVariableLookup, ancestors: LiquidHtmlNode[]) => {
    if (node.lookups.length === 0) return;

    // The target of a write is being DEFINED, not read: `{% hash_assign a['k'] = v %}`
    // and `{% function a['k'] = 'p' %}` must not report `k` as an unknown property.
    const parent = ancestors[ancestors.length - 1];
    if (isWriteTarget(parent, node)) return;

    lookups.push(node);
  };

  const returnShape = (): PropertyShape | undefined => {
    if (returnsUnresolvable || returnShapes.length === 0) return undefined;
    // Branches that disagree about the KIND of value they return leave the caller
    // with no single shape to check against.
    const merged = returnShapes.reduce((a, b) =>
      a.kind === b.kind ? mergeShapes(a, b) : UNKNOWN_SHAPE,
    );
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
    // `<<` pushes onto an array. Only a base already known to be an array can be
    // narrowed by it; for anything else (nil, a hash, an unknown) the result is not
    // something we can claim.
    if (previous?.kind !== 'array') return undefined;
    const item = write.valueShape ?? UNKNOWN_SHAPE;
    return {
      kind: 'array' as const,
      itemShape: previous.itemShape ? mergeShapes(previous.itemShape, item) : item,
    };
  }

  // `{% assign a['k'] << v %}` pushes onto a nested array; the key is known to exist,
  // its contents are not.
  const valueShape = write.operator === '<<' ? UNKNOWN_SHAPE : (write.valueShape ?? UNKNOWN_SHAPE);

  // A write at a path NARROWS a known base. With no base, the write is still the only
  // evidence there is, and it proves "a hash with AT LEAST this key" — which is what
  // `open` says. Claiming a closed `{ [key]: value }` instead, as this once did, said
  // the variable has ONLY that key and reported every other read of it as unknown; an
  // open shape reports none of them, and lets completion offer the key it does know.
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
 * Memoized partial analyses, keyed on `(partial identity, partial source, bindings)` —
 * the arguments are part of the key because that is the whole point: `include_related:
 * true` and `include_related: false` are different questions with different answers.
 *
 * A cached entry also records every file the analysis READ, so a hit is revalidated
 * against their current contents before it is trusted. Keying on the callee's own
 * source is not enough: its answer depends on the `.graphql` documents and further
 * partials it reads, and a long-lived host (language server, MCP supervisor) would
 * otherwise keep serving a shape from a query file that has since been edited.
 */
const analysisCache = createBoundedCache<CacheEntry>(RETURN_SHAPE_CACHE_LIMIT);

async function analyzePartial(
  partial: AnalyzableFile,
  bindings: ReadonlyMap<string, Binding>,
  deps: ShapeAnalyzerDeps,
  options: { depth: number; callChain: ReadonlySet<string> },
): Promise<PartialAnalysis> {
  const key = [partial.uri, partial.source, bindingsKey(bindings)].join(' ');
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
  // A parameter the call site did not pass, and that the partial never assigns itself,
  // holds nil for the whole of this analysis. `extractUndefinedVariables` is the one
  // answer to "what does this source never define", and it sees the definitions this
  // analyzer does not track (`capture`, `for`, `increment`).
  const provablyNil = new Set(
    extractUndefinedVariables(partial.source).required.filter((name) => !bindings.has(name)),
  );
  const analyzer = createShapeAnalyzer(deps, { ...options, bindings, provablyNil, reads });

  // Only the tags matter here: the callee's own property reads are reported when the
  // callee is linted as a file of its own.
  await visit<SourceCodeType.LiquidHtml, void>(partial.ast, {
    async LiquidTag(node, ancestors) {
      await analyzer.handleLiquidTag(node, ancestors);
    },
  });

  return { shape: analyzer.returnShape(), reads };
}

async function isStale(analysis: PartialAnalysis, deps: ShapeAnalyzerDeps): Promise<boolean> {
  for (const [uri, content] of analysis.reads) {
    if ((await deps.readContent(uri)) !== content) return true;
  }
  return false;
}

/**
 * The bindings, as a key. Only what the callee can actually branch on goes in: a
 * boolean it may forward into an `@include`, and the STRUCTURE of a shape it may
 * return part of.
 */
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
 * Navigate a shape using the `dig` filters from a tag's result filters.
 * Returns the navigated shape, the original when there are no dig filters, or
 * `undefined` when the path is dynamic or leads nowhere.
 */
function applyDigFilters(shape: PropertyShape, filters: LiquidFilter[]): PropertyShape | undefined {
  const digPath = filters.filter((filter) => filter.name === 'dig');
  if (digPath.length === 0) return shape;

  const path = digPathOf(digPath);
  if (!path) return undefined;

  const result = lookupPropertyPath(shape, path);
  return result.error || !result.shape ? undefined : result.shape;
}

/** The string keys of a `dig` filter chain, or `undefined` when any is not static. */
function digPathOf(filters: LiquidFilter[]): string[] | undefined {
  const path: string[] = [];
  for (const filter of filters) {
    if (filter.name !== 'dig') return undefined;
    const arg = filter.args?.[0];
    if (arg?.type !== NodeTypes.String) return undefined;
    path.push(arg.value);
  }
  return path;
}

/**
 * The end of the innermost conditional branch enclosing a write, or `undefined` when it
 * is on the straight-line path. `for`/`tablerow` bodies are branches too — a write in a
 * loop that may run zero times is exactly as uncertain.
 */
function enclosingBranchEnd(ancestors: LiquidHtmlNode[]): number | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i].type === NodeTypes.LiquidBranch) return ancestors[i].position.end;
  }
  return undefined;
}

export function buildLookupPath(lookups: LiquidExpression[]): string[] | undefined {
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

/** The JSON string a `parse_json` chain parses: the expression, or a `default:` fallback. */
function jsonStringFrom(expression: ValueExpression, filters: LiquidFilter[]): string | undefined {
  if (expression.type === NodeTypes.String) return expression.value;

  const fallback = filters.find((filter) => filter.name === 'default')?.args?.[0];
  return fallback?.type === NodeTypes.String ? fallback.value : undefined;
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

function isNilExpression(expression: ValueExpression): boolean {
  return expression.type === NodeTypes.LiquidLiteral && expression.value === null;
}

function unwrapArgumentValue(value: LiquidNamedArgument['value']): {
  expression?: ValueExpression;
  filters: LiquidFilter[];
} {
  // A `graphql` tag's argument is a LiquidVariable (it may carry filters); every other
  // tag's is a bare expression. A nested named argument is a hash pair, which is not a
  // value we resolve.
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
