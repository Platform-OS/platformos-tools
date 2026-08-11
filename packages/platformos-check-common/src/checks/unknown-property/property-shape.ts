import {
  SelectionSetNode,
  FieldNode,
  FragmentDefinitionNode,
  DirectiveNode,
  ValueNode,
} from 'graphql/language';
import { GraphQLDocumentNode } from '@platformos/platformos-common';
import {
  GraphQLSchema,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLNamedType,
  isListType,
  isNonNullType,
  isObjectType,
  isInterfaceType,
  isEnumType,
  getNamedType,
} from 'graphql';
import { parseJSON } from '../../json';
import { isError } from '../../utils';
import { buildGraphQLSchema } from '../../utils/graphql-schema';

export interface PropertyShape {
  /** `unknown` is a value that IS there and whose structure nobody can see into. */
  kind: 'object' | 'array' | 'primitive' | 'unknown';
  properties?: Map<string, PropertyShape>;
  itemShape?: PropertyShape;
  primitiveType?: 'string' | 'number' | 'boolean' | 'null';
  /** The property may be absent, so reads of it and through it are unverifiable. */
  optional?: true;
  /** The object may hold properties it does not name; what it does name is still known. */
  open?: true;
  /** An empty hash awaiting writes. Unlike any other open shape, it CLOSES on the first. */
  placeholder?: true;
}

export const UNKNOWN_SHAPE: PropertyShape = { kind: 'unknown' };

/** An ABSENT value: a written `nil`, a JSON `null`. Not {@link UNKNOWN_SHAPE}. */
export const NIL_SHAPE: PropertyShape = { kind: 'primitive', primitiveType: 'null' };

/** Takes the value rather than the node, so this module stays free of parser types. */
export function primitiveShapeOfLiteral(value: unknown): PropertyShape {
  if (value === null) return NIL_SHAPE;
  if (typeof value === 'boolean') return { kind: 'primitive', primitiveType: 'boolean' };
  return { kind: 'primitive' };
}

/** An empty literal is a placeholder something fills later, not a hash with no keys. */
export function objectShape(properties: Map<string, PropertyShape>): PropertyShape {
  return properties.size === 0
    ? { kind: 'object', properties, open: true, placeholder: true }
    : { kind: 'object', properties };
}

/** A REBUILT object shape: the caller decides `open`, and `placeholder` never survives. */
function objectWith(properties: Map<string, PropertyShape>, open: boolean): PropertyShape {
  return open ? { kind: 'object', properties, open: true } : { kind: 'object', properties };
}

export interface LookupResult {
  shape: PropertyShape | undefined;
  error?: 'unknown_property' | 'primitive_access';
  errorAt?: number;
}

/** A boolean whose value we either know or explicitly do not. Never guessed. */
export type ConditionValue = boolean | 'unknown';

/** Call-site arguments resolved to booleans, which is all `@include`/`@skip` consume. */
export type GraphQLArgumentValues = ReadonlyMap<string, ConditionValue>;

/**
 * The protocol-level field a `{% graphql %}` result MAY carry. Optional, not present: a
 * successful result has no `errors` key at all.
 */
const GRAPHQL_ERRORS_SHAPE: PropertyShape = {
  kind: 'array',
  optional: true,
  itemShape: {
    kind: 'object',
    properties: new Map([['message', { kind: 'primitive', primitiveType: 'string' }]]),
  },
};

/** GraphQL types we can name a Liquid primitive for. Everything else is a custom scalar. */
const PRIMITIVE_TYPE_BY_SCALAR: Record<string, 'string' | 'number' | 'boolean'> = {
  String: 'string',
  ID: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
};

/** Copy of `shape` with the conditional marker set or cleared. */
function withOptional(shape: PropertyShape, optional: boolean): PropertyShape {
  if (optional) return shape.optional ? shape : { ...shape, optional: true };
  if (!shape.optional) return shape;
  const { optional: _dropped, ...rest } = shape;
  return rest;
}

/**
 * Merge two facts about ONE value — two selections of the same field, a fragment and the
 * level it spreads into. Both sides are true, so the merge knows both.
 */
export function mergeShapes(a: PropertyShape, b: PropertyShape): PropertyShape {
  return withOptional(mergeShapeKinds(a, b), a.optional === true && b.optional === true);
}

/**
 * Merge two ALTERNATIVES — values only one of which is the one the code produced. The
 * opposite of {@link mergeShapes} where it matters: the value may BE the one nobody can
 * see into, so `unknown` withdraws every claim instead of contributing nothing.
 *
 * WITHDRAWING A CLAIM IS NOT THE SAME AS FORGETTING WHAT THE OTHER BRANCH SAID, and this is
 * where one analyzer serves two consumers. Absorbing outright is right for the diagnostic —
 * nothing is reportably absent when a branch might hold anything — and throws away names the
 * editor has no reason to lose, with no false positive on that side to suppress. So an object
 * branch survives as an OPEN shape whose properties are all OPTIONAL, which is exactly "these
 * may be here, and so may anything else": `lookupPropertyPath` can report nothing through it,
 * `getAvailableProperties` still lists the names. Any other kind carries no names to keep, so
 * `unknown` absorbs it.
 */
export function mergeAlternatives(a: PropertyShape, b: PropertyShape): PropertyShape {
  const merged = mergeAlternativeKinds(a, b);
  if (merged.kind === 'unknown') return merged;
  return withOptional(merged, a.optional === true || b.optional === true);
}

/**
 * What an object shape still says when the value might instead be something unseeable.
 *
 * Already-unverifiable shapes are returned as they are, so folding a list whose elements are
 * mostly unreadable — `[a, b, {"x": 1}, c]` — rebuilds the property map once instead of once
 * per unknown element.
 */
function unverifiable(shape: PropertyShape): PropertyShape {
  if (isUnverifiable(shape)) return shape;

  const properties = new Map<string, PropertyShape>();
  for (const [key, value] of shape.properties ?? []) properties.set(key, withOptional(value, true));
  return objectWith(properties, true);
}

function isUnverifiable(shape: PropertyShape): boolean {
  if (shape.open !== true || shape.placeholder === true) return false;
  for (const value of shape.properties?.values() ?? []) {
    if (value.optional !== true) return false;
  }
  return true;
}

/** The one shape describing whichever of `shapes` a read reaches. */
export function foldAlternatives(shapes: PropertyShape[]): PropertyShape | undefined {
  return shapes.length === 0 ? undefined : shapes.reduce(mergeAlternatives);
}

function mergeAlternativeKinds(a: PropertyShape, b: PropertyShape): PropertyShape {
  if (a.kind === 'unknown' || b.kind === 'unknown') {
    const known = a.kind === 'unknown' ? b : a;
    return known.kind === 'object' ? unverifiable(known) : UNKNOWN_SHAPE;
  }

  if (a.kind === 'object' && b.kind === 'object') {
    const properties = new Map<string, PropertyShape>();
    for (const [key, shape] of a.properties ?? []) {
      const other = b.properties?.get(key);
      properties.set(key, other ? mergeAlternatives(shape, other) : withOptional(shape, true));
    }
    for (const [key, shape] of b.properties ?? []) {
      if (!properties.has(key)) properties.set(key, withOptional(shape, true));
    }
    return objectWith(properties, a.open === true || b.open === true);
  }

  if (a.kind === 'array' && b.kind === 'array') {
    const itemShape =
      a.itemShape && b.itemShape ? mergeAlternatives(a.itemShape, b.itemShape) : undefined;
    return { kind: 'array', itemShape };
  }

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    if (a.primitiveType === b.primitiveType) return a;
    // A nil alternative may be absent, and `nil.foo` is nil rather than an error, so the
    // merge must not decay to a bare primitive — which `lookupPropertyPath` reports on.
    if (a.primitiveType === 'null' || b.primitiveType === 'null') return UNKNOWN_SHAPE;
    return { kind: 'primitive' };
  }

  return UNKNOWN_SHAPE;
}

function mergeShapeKinds(a: PropertyShape, b: PropertyShape): PropertyShape {
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;

  if (a.kind === 'object' && b.kind === 'object') {
    const properties = new Map(a.properties);
    if (b.properties) {
      for (const [key, val] of b.properties) {
        const existing = properties.get(key);
        properties.set(key, existing ? mergeShapes(existing, val) : val);
      }
    }
    return objectWith(properties, a.open === true || b.open === true);
  }
  if (a.kind === 'array' && b.kind === 'array') {
    const itemShape =
      a.itemShape && b.itemShape
        ? mergeShapes(a.itemShape, b.itemShape)
        : a.itemShape || b.itemShape;
    return { kind: 'array', itemShape };
  }
  return a;
}

/** Set `key`, merging with what is already there rather than replacing it. */
function addProperty(
  properties: Map<string, PropertyShape>,
  key: string,
  shape: PropertyShape,
): void {
  const existing = properties.get(key);
  properties.set(key, existing ? mergeShapes(existing, shape) : shape);
}

/**
 * Infer shape from a parsed JSON value
 */
export function inferShapeFromJSON(value: unknown): PropertyShape {
  if (value === null) {
    return NIL_SHAPE;
  }
  if (typeof value === 'string') {
    return { kind: 'primitive', primitiveType: 'string' };
  }
  if (typeof value === 'number') {
    return { kind: 'primitive', primitiveType: 'number' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'primitive', primitiveType: 'boolean' };
  }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      itemShape: foldAlternatives(value.map((item) => inferShapeFromJSON(item))),
    };
  }
  if (typeof value === 'object') {
    const properties = new Map<string, PropertyShape>();
    for (const [key, val] of Object.entries(value)) {
      properties.set(key, inferShapeFromJSON(val));
    }
    return objectShape(properties);
  }
  return { kind: 'primitive' };
}

/**
 * Try to parse a string as JSON and infer its shape
 */
export function inferShapeFromJSONString(jsonString: string): PropertyShape | undefined {
  const parsed = parseJSON(jsonString);
  // parseJSON returns Error on strict mode failure, or undefined for invalid JSON
  // We only want to infer shapes for valid JSON objects/arrays
  if (isError(parsed) || parsed === undefined || parsed === null) {
    return undefined;
  }
  // Only infer shapes for objects and arrays, not primitive JSON values
  if (typeof parsed !== 'object') {
    return undefined;
  }
  return inferShapeFromJSON(parsed);
}

/**
 * Unwrap NonNull and get the underlying type
 */
function unwrapType(type: GraphQLOutputType): GraphQLOutputType {
  if (isNonNullType(type)) {
    return type.ofType;
  }
  return type;
}

/**
 * Check if a type is a list (array) type
 */
function isArrayType(type: GraphQLOutputType): boolean {
  const unwrapped = unwrapType(type);
  return isListType(unwrapped);
}

/** A composite type whose fields we can look a selection up in. */
type SelectableType = GraphQLObjectType | GraphQLInterfaceType;

function asSelectableType(type: GraphQLNamedType | null | undefined): SelectableType | undefined {
  if (!type) return undefined;
  return isObjectType(type) || isInterfaceType(type) ? type : undefined;
}

/** A custom scalar is `unknown`, not `primitive`: platformOS returns hashes through them. */
function leafShape(fieldType: GraphQLOutputType | undefined): PropertyShape {
  if (!fieldType) return { kind: 'primitive' };

  const named = getNamedType(fieldType);
  const primitiveType = PRIMITIVE_TYPE_BY_SCALAR[named.name];
  const valueShape: PropertyShape = primitiveType
    ? { kind: 'primitive', primitiveType }
    : isEnumType(named)
      ? { kind: 'primitive', primitiveType: 'string' }
      : { kind: 'unknown' };

  return isArrayType(fieldType) ? { kind: 'array', itemShape: valueShape } : valueShape;
}

interface GraphQLShapeContext {
  fragments: Map<string, FragmentDefinitionNode>;
  schema?: GraphQLSchema;
  /** Resolved values of the operation's variables, from the call site and the declared defaults. */
  variables: Map<string, ConditionValue>;
}

/** Whether a selection ends up in the response. */
type Presence = 'present' | 'absent' | 'conditional';

/** Resolve `@include(if:)` / `@skip(if:)` against the operation's variable values. */
function evaluatePresence(
  directives: readonly DirectiveNode[] | undefined,
  ctx: GraphQLShapeContext,
): Presence {
  if (!directives || directives.length === 0) return 'present';

  let presence: Presence = 'present';

  for (const directive of directives) {
    const name = directive.name.value;
    if (name !== 'include' && name !== 'skip') continue;

    const condition = directive.arguments?.find((arg) => arg.name.value === 'if');
    if (!condition) continue;

    const value = resolveConditionValue(condition.value, ctx);
    if (value === 'unknown') {
      presence = 'conditional';
      continue;
    }

    if (name === 'include' ? !value : value) return 'absent';
  }

  return presence;
}

function resolveConditionValue(value: ValueNode, ctx: GraphQLShapeContext): ConditionValue {
  if (value.kind === 'BooleanValue') return value.value;
  if (value.kind === 'Variable') return ctx.variables.get(value.name.value) ?? 'unknown';
  return 'unknown';
}

/**
 * `activeFragments` are the spreads open on the current chain: a cyclic pair is invalid
 * GraphQL but reachable from a half-typed buffer, so re-entry stops rather than recurses.
 */
function selectionSetToShape(
  selectionSet: SelectionSetNode,
  parentType: SelectableType | undefined,
  ctx: GraphQLShapeContext,
  activeFragments: ReadonlySet<string>,
): PropertyShape {
  const properties = new Map<string, PropertyShape>();
  /** A spread we could not resolve: this level holds fields we cannot name. */
  let open = false;

  for (const selection of selectionSet.selections) {
    const presence = evaluatePresence(selection.directives, ctx);
    if (presence === 'absent') continue;
    const conditional = presence === 'conditional';

    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      const fieldName = (field.alias ?? field.name).value;
      const schemaField = parentType?.getFields()[field.name.value];
      const fieldType = schemaField?.type;

      if (field.selectionSet) {
        const nestedType = asSelectableType(fieldType ? getNamedType(fieldType) : undefined);
        const nestedShape = selectionSetToShape(
          field.selectionSet,
          nestedType,
          ctx,
          activeFragments,
        );
        const shape: PropertyShape =
          fieldType && isArrayType(fieldType)
            ? { kind: 'array', itemShape: nestedShape }
            : nestedShape;
        addProperty(properties, fieldName, withOptional(shape, conditional));
      } else {
        addProperty(properties, fieldName, withOptional(leafShape(fieldType), conditional));
      }
      continue;
    }

    // An unresolvable spread contributes nothing AND leaves the level open.
    const spreadSelectionSet =
      selection.kind === 'InlineFragment'
        ? selection.selectionSet
        : activeFragments.has(selection.name.value)
          ? undefined
          : ctx.fragments.get(selection.name.value)?.selectionSet;
    if (!spreadSelectionSet) {
      open = true;
      continue;
    }

    const typeCondition =
      selection.kind === 'InlineFragment'
        ? selection.typeCondition
        : ctx.fragments.get(selection.name.value)?.typeCondition;
    const conditionType = typeCondition
      ? asSelectableType(ctx.schema?.getType(typeCondition.name.value))
      : undefined;

    const nextActive =
      selection.kind === 'FragmentSpread'
        ? new Set(activeFragments).add(selection.name.value)
        : activeFragments;

    const spreadShape = selectionSetToShape(
      spreadSelectionSet,
      conditionType ?? parentType,
      ctx,
      nextActive,
    );

    for (const [key, shape] of spreadShape.properties ?? []) {
      addProperty(properties, key, withOptional(shape, conditional || shape.optional === true));
    }
    // A fragment that could not name all of its own fields cannot name all of ours.
    if (spreadShape.open) open = true;
  }

  return objectWith(properties, open);
}

/**
 * The response shape an operation produces. Takes the PARSED document, so a query called
 * from thirty call sites is parsed once.
 */
export function inferShapeFromGraphQL(
  node: GraphQLDocumentNode,
  schemaString?: string,
  args?: GraphQLArgumentValues,
): PropertyShape | undefined {
  const document = node.document;
  if (!document) return undefined; // did not parse — no shape, as before

  try {
    let schema: GraphQLSchema | undefined;

    if (schemaString) {
      try {
        schema = buildGraphQLSchema(schemaString);
      } catch {
        // Schema parse error - continue without schema
      }
    }

    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of document.definitions) {
      if (definition.kind === 'FragmentDefinition') {
        fragments.set(definition.name.value, definition);
      }
    }

    for (const definition of document.definitions) {
      if (definition.kind === 'OperationDefinition' && definition.selectionSet) {
        // Get the root type based on operation type
        let rootType: SelectableType | undefined;
        if (schema) {
          if (definition.operation === 'query') {
            rootType = asSelectableType(schema.getQueryType());
          } else if (definition.operation === 'mutation') {
            rootType = asSelectableType(schema.getMutationType());
          }
        }

        const variables = new Map<string, ConditionValue>();
        for (const variableDefinition of definition.variableDefinitions ?? []) {
          const name = variableDefinition.variable.name.value;
          // A value passed at the call site wins; otherwise the query's own default
          // decides, and `$flag: Boolean = false` is as good as passing `false`.
          const passed = args?.get(name);
          if (passed !== undefined) {
            variables.set(name, passed);
          } else if (variableDefinition.defaultValue?.kind === 'BooleanValue') {
            variables.set(name, variableDefinition.defaultValue.value);
          } else {
            variables.set(name, 'unknown');
          }
        }

        const shape = selectionSetToShape(
          definition.selectionSet,
          rootType,
          { fragments, schema, variables },
          new Set(),
        );

        const properties = new Map(shape.properties);
        if (!properties.has('errors')) properties.set('errors', GRAPHQL_ERRORS_SHAPE);
        // Spread, so an `open` marker on the root level survives adding `errors`.
        return { ...shape, properties };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shape at `path`, or an error when it does not exist or passes through a primitive.
 * An `unknown` shape and an optional property end verification WITHOUT an error.
 */
export function lookupPropertyPath(shape: PropertyShape, path: string[]): LookupResult {
  let current: PropertyShape = shape;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    if (current.kind === 'unknown') {
      return { shape: undefined };
    }

    if (current.kind === 'primitive') {
      // A JSON `null` is a key with nothing in it, so a read through it is unverifiable
      // rather than a type error — the same reason a written `nil` claims no shape.
      //
      // BEFORE the `size` shortcut, not after: measured on a live instance, `nil.size` is
      // itself nil, so treating it as a number and then reporting the read under it was a
      // false positive on exactly the case this guard exists for.
      //
      //   {% assign x = {"a": null} %}
      //   x.a.size -> nil    x.a.foo -> nil    x.a.size.foo -> nil
      if (current.primitiveType === 'null') return { shape: undefined };
      // `size` is defined on every Liquid value, strings included.
      if (key === 'size') {
        current = { kind: 'primitive', primitiveType: 'number' };
        continue;
      }
      return { shape: undefined, error: 'primitive_access', errorAt: i };
    }

    if (current.kind === 'array') {
      // Array access: check for built-in properties or index access
      if (key === 'first' || key === 'last') {
        // An array whose item shape is unknown — `[]`, or one built by a filter — can
        // verify nothing about an item.
        if (!current.itemShape) return { shape: undefined };
        current = current.itemShape;
        continue;
      }
      if (key === 'size') {
        current = { kind: 'primitive', primitiveType: 'number' };
        continue;
      }
      // Numeric index access returns item shape
      if (/^\d+$/.test(key)) {
        if (!current.itemShape) return { shape: undefined };
        current = current.itemShape;
        continue;
      }
      // Unknown array property
      return { shape: undefined, error: 'unknown_property', errorAt: i };
    }

    if (current.kind === 'object') {
      const prop = current.properties?.get(key);
      if (prop) {
        // A property that may not be there cannot be verified, and neither can
        // anything under it.
        if (prop.optional) return { shape: undefined };
        current = prop;
        continue;
      }

      // After the properties: Liquid looks the key up first, so a `size` key wins.
      if (key === 'size') {
        current = { kind: 'primitive', primitiveType: 'number' };
        continue;
      }

      // An incomplete selection set cannot say a field is absent.
      if (current.open) return { shape: undefined };

      return { shape: undefined, error: 'unknown_property', errorAt: i };
    }
  }

  return { shape: current };
}

/**
 * Every object level OPEN, for a partial that mutated through a reference this analysis
 * could not follow. Only "no such field" is withdrawn; what the shape names still holds.
 */
export function deepOpen(shape: PropertyShape): PropertyShape {
  if (shape.kind === 'array') {
    return shape.itemShape ? { ...shape, itemShape: deepOpen(shape.itemShape) } : shape;
  }
  if (shape.kind !== 'object') return shape;

  const properties = new Map<string, PropertyShape>();
  for (const [key, value] of shape.properties ?? []) properties.set(key, deepOpen(value));
  return { ...shape, properties, open: true };
}

/**
 * Get available properties at a given shape (for autocomplete)
 */
export function getAvailableProperties(shape: PropertyShape): string[] {
  if (shape.kind === 'object' && shape.properties) {
    return Array.from(shape.properties.keys());
  }
  if (shape.kind === 'array') {
    return ['first', 'last', 'size'];
  }
  if (shape.kind === 'primitive' && shape.primitiveType === 'string') {
    return ['size'];
  }
  return [];
}

/**
 * A write through an lvalue path: the written key is added or replaced, every sibling
 * survives. A caller with no shape for the base must NOT call this — there is no way to
 * say "at least `k`", so a fabricated base claims the variable holds only what was written.
 */
export function mergeShapeAtPath(
  shape: PropertyShape,
  path: string[],
  valueShape: PropertyShape,
): PropertyShape {
  if (path.length === 0) return valueShape;

  const [key, ...rest] = path;

  if (shape.kind === 'array') {
    // A hash-style key written onto an array is not something we can model.
    if (!/^\d+$/.test(key)) return UNKNOWN_SHAPE;
    // The item shape describes EVERY element and the write proves ONE, so they are
    // alternatives rather than evidence about the same value.
    const written = mergeShapeAtPath(shape.itemShape ?? UNKNOWN_SHAPE, rest, valueShape);
    return {
      kind: 'array',
      itemShape: shape.itemShape ? mergeAlternatives(written, shape.itemShape) : written,
    };
  }

  // Indexing a primitive or an unknown value proves it is really a hash, but says
  // nothing about what else is in it — so the result is a hash of unknown contents.
  if (shape.kind !== 'object') return UNKNOWN_SHAPE;

  const properties = new Map(shape.properties);
  properties.set(
    key,
    rest.length === 0
      ? valueShape
      : mergeShapeAtPath(
          properties.get(key) ?? { kind: 'object', properties: new Map() },
          rest,
          valueShape,
        ),
  );

  // A write closes a PLACEHOLDER; any other openness survives it.
  return objectWith(properties, shape.open === true && !shape.placeholder);
}
