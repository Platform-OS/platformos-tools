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
  /**
   * `unknown` is a value whose STRUCTURE is not known — the result of a filter we
   * cannot see through, a partial we could not resolve, a custom GraphQL scalar.
   * It is not the absence of a shape: the property is known to exist, so a read of
   * it is legal, and every read THROUGH it is unverifiable rather than wrong.
   */
  kind: 'object' | 'array' | 'primitive' | 'unknown';
  /** For objects: map of property name to nested shape */
  properties?: Map<string, PropertyShape>;
  /** For arrays: shape of array items */
  itemShape?: PropertyShape;
  /** For primitives: the primitive type */
  primitiveType?: 'string' | 'number' | 'boolean' | 'null';
  /**
   * The property MAY be absent from the value — a GraphQL field behind an
   * `@include`/`@skip` whose condition we cannot resolve. Reads of it, and through
   * it, are unverifiable: we can neither confirm nor deny the field is there.
   */
  optional?: true;
  /**
   * For objects: there may be properties this shape does not name — a GraphQL
   * selection set carrying a fragment spread we could not resolve. What IS named is
   * still known, so reads of those are verified as usual; a read of anything else
   * cannot be called unknown.
   */
  open?: true;
  /**
   * For objects: an EMPTY hash written to be filled in — `{% assign c = {} %}`, then
   * `hash_assign c['errors'] = …`. It is open because it describes nothing yet, and
   * unlike every other open shape it CLOSES on the first write it can see: the literal
   * plus the writes are the whole picture. See {@link mergeShapeAtPath}.
   */
  placeholder?: true;
}

export const UNKNOWN_SHAPE: PropertyShape = { kind: 'unknown' };

/**
 * An object shape from a set of named properties.
 *
 * An EMPTY one is open. `{}` is not a description of a value, it is a placeholder a
 * platformOS partial fills later — `assign c = { "errors": {}, "valid": true }` and then
 * `hash_assign errors[field_name] = …` two partials away, through the reference Liquid
 * hands out. Reading `c.errors.email` off a closed empty object is a false positive,
 * and there are dozens of them on a real project. A write we can SEE is different: it
 * is evidence, and {@link mergeShapeAtPath} closes the level it writes into.
 */
export function objectShape(properties: Map<string, PropertyShape>): PropertyShape {
  return properties.size === 0
    ? { kind: 'object', properties, open: true, placeholder: true }
    : { kind: 'object', properties };
}

export interface LookupResult {
  shape: PropertyShape | undefined;
  error?: 'unknown_property' | 'primitive_access';
  errorAt?: number;
}

/** A boolean whose value we either know or explicitly do not. Never guessed. */
export type ConditionValue = boolean | 'unknown';

/**
 * The `{% graphql %}` call site's named arguments, resolved to booleans where they
 * are provably boolean. Only booleans matter: they are what `@include`/`@skip` can
 * consume.
 */
export type GraphQLArgumentValues = ReadonlyMap<string, ConditionValue>;

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
 * Merge two shapes together, combining their properties.
 *
 * The conditional marker survives only when BOTH sides carry it: a field that one
 * branch selects unconditionally is unconditionally present, however many other
 * branches guard it.
 */
export function mergeShapes(a: PropertyShape, b: PropertyShape): PropertyShape {
  return withOptional(mergeShapeKinds(a, b), a.optional === true && b.optional === true);
}

function mergeShapeKinds(a: PropertyShape, b: PropertyShape): PropertyShape {
  // An unknown structure carries no information, so whatever the other side knows
  // is what the merge knows.
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
    // Openness spreads: if either side may hold properties it does not name, so may
    // the merge.
    return a.open || b.open
      ? { kind: 'object', properties, open: true }
      : { kind: 'object', properties };
  }
  if (a.kind === 'array' && b.kind === 'array') {
    const itemShape =
      a.itemShape && b.itemShape
        ? mergeShapes(a.itemShape, b.itemShape)
        : a.itemShape || b.itemShape;
    return { kind: 'array', itemShape };
  }
  // Different kinds or primitives - prefer the first
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
    return { kind: 'primitive', primitiveType: 'null' };
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
    // Merge shapes from all array elements
    let itemShape: PropertyShape | undefined;
    for (const item of value) {
      const shape = inferShapeFromJSON(item);
      itemShape = itemShape ? mergeShapes(itemShape, shape) : shape;
    }
    return { kind: 'array', itemShape };
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

/**
 * The shape of a field with no selection set.
 *
 * A custom scalar is `unknown`, not `primitive`: platformOS returns hashes through
 * them (`Record.properties: HashObject`), so calling them primitive turns
 * `record.properties.color` into a bogus "cannot access property on primitive".
 * Without a schema every leaf stays `primitive`, as before.
 */
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

/**
 * Resolve `@include(if:)` / `@skip(if:)` against the operation's variable values.
 *
 * `conditional` — the condition is a variable nobody proved a value for — is the case
 * that keeps this from being a false-positive machine: the field goes into the shape,
 * marked, and reads through it are not verified.
 */
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
 * Convert a GraphQL SelectionSet to a PropertyShape using schema for type info.
 *
 * `activeFragments` are the spreads open on the current chain. A cyclic pair
 * (`fragment a { ...b }` / `fragment b { ...a }`) is invalid GraphQL but reachable
 * from a half-typed editor buffer, so re-entry stops instead of recursing forever.
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

    // A spread contributes its fragment's fields at THIS level. An unresolvable
    // spread — defined in another file, not yet typed out, or cyclic — contributes
    // nothing AND leaves the level open: what it would have added is unknown, so no
    // read here can be called unknown either. Silence, never "no such field".
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

  return open ? { kind: 'object', properties, open: true } : { kind: 'object', properties };
}

/**
 * Extract the response shape a GraphQL operation produces.
 *
 * Takes the PARSED document, not a string: a file-based `{% graphql %}` gets the parse
 * its `AppFile` already holds, so a query called from thirty call sites is parsed once
 * rather than thirty times, and an inline `{% graphql %}…{% endgraphql %}` body — which
 * has no file — parses its own text through the same `parseGraphql`.
 *
 * @param node - The GraphQL query/mutation, parsed
 * @param schemaString - Optional GraphQL schema SDL string for accurate type inference
 * @param args - Argument values the `{% graphql %}` call site passed, for `@include`/`@skip`
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

        // platformOS always exposes a top-level 'errors' array on graphql results
        // (GraphQL protocol-level errors), regardless of what's in the selection set.
        const properties = new Map(shape.properties);
        if (!properties.has('errors')) {
          properties.set('errors', {
            kind: 'array',
            itemShape: {
              kind: 'object',
              properties: new Map([['message', { kind: 'primitive', primitiveType: 'string' }]]),
            },
          });
        }
        return { kind: 'object', properties };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Look up a property path in a shape, returning the shape at that path.
 * Returns undefined shape with error info if the path doesn't exist or passes through a primitive.
 *
 * An `unknown` shape and a conditional property both end verification with no error:
 * there is nothing left to be right or wrong about.
 */
export function lookupPropertyPath(shape: PropertyShape, path: string[]): LookupResult {
  let current: PropertyShape = shape;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    if (current.kind === 'unknown') {
      return { shape: undefined };
    }

    if (current.kind === 'primitive') {
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

      // `size` is the number of keys on a hash, as it is a count on an array and a
      // length on a string. Answered AFTER the properties, because a hash that has its
      // own `size` key returns that value — Liquid looks the key up first.
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
 * The same shape with every object level OPEN — it may hold properties this shape
 * cannot name.
 *
 * For a partial that mutated something we could not follow: a `for` item, a
 * `{% assign line = ll %}` alias, a dynamic key. Liquid hands out references, so a
 * write through an alias lands in the value the caller receives, and every one of those
 * writes is a field this shape does not have. What the shape DOES name is still right,
 * so navigation and primitive checks survive; only "no such field" is withdrawn.
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
 * Merge a value shape into `shape` at `path`, keeping everything already known.
 *
 * This is a WRITE THROUGH AN LVALUE PATH — `{% hash_assign a['k'] = v %}`,
 * `{% assign a['k'] = v %}`, `{% function a['k'] = 'p' %}` — so it narrows: the
 * written key is added or replaced and every sibling survives. A caller with no
 * shape for the base must not call this. Fabricating `{ k }` out of an empty object
 * claims the base has ONLY `k`, and `PropertyShape` cannot say "at least `k`", so
 * every other read of that variable was reported as unknown.
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
    // Writing an element narrows the ITEM shape, and the value stays an array. The
    // item shape describes EVERY element, so the write is merged in rather than
    // replacing what the other elements are known to have.
    const written = mergeShapeAtPath(shape.itemShape ?? UNKNOWN_SHAPE, rest, valueShape);
    return {
      kind: 'array',
      itemShape: shape.itemShape ? mergeShapes(written, shape.itemShape) : written,
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

  // A write into a PLACEHOLDER closes it: `{% assign f = {} %}` followed by
  // `{% hash_assign f['page'] = 1 %}` is the whole of what `f` holds, which is what makes
  // `f.tag` reportable. Any other openness survives the write — a shape that is open
  // because we never saw the value (a partial's return, a write onto an unknown base, a
  // fragment we could not resolve) does not become complete just because we watched one
  // key go in.
  return shape.open && !shape.placeholder
    ? { kind: 'object', properties, open: true }
    : { kind: 'object', properties };
}
