import { parse, SelectionSetNode, FieldNode } from 'graphql/language';
import {
  buildSchema,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLOutputType,
  isListType,
  isNonNullType,
  isObjectType,
  getNamedType,
} from 'graphql';
import { parseJSON } from '../../json';
import { isError } from '../../utils';

export interface PropertyShape {
  kind: 'object' | 'array' | 'primitive';
  /** For objects: map of property name to nested shape */
  properties?: Map<string, PropertyShape>;
  /** For arrays: shape of array items */
  itemShape?: PropertyShape;
  /** For primitives: the primitive type */
  primitiveType?: 'string' | 'number' | 'boolean' | 'null';
}

export interface LookupResult {
  shape: PropertyShape | undefined;
  error?: 'unknown_property' | 'primitive_access';
  errorAt?: number;
}

/**
 * Merge two shapes together, combining their properties
 */
function mergeShapes(a: PropertyShape, b: PropertyShape): PropertyShape {
  // If same kind, merge appropriately
  if (a.kind === 'object' && b.kind === 'object') {
    const properties = new Map(a.properties);
    if (b.properties) {
      for (const [key, val] of b.properties) {
        const existing = properties.get(key);
        if (existing) {
          properties.set(key, mergeShapes(existing, val));
        } else {
          properties.set(key, val);
        }
      }
    }
    return { kind: 'object', properties };
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
    return { kind: 'object', properties };
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

/**
 * Convert a GraphQL SelectionSet to a PropertyShape using schema for type info
 */
function selectionSetToShape(
  selectionSet: SelectionSetNode,
  parentType?: GraphQLObjectType,
): PropertyShape {
  const properties = new Map<string, PropertyShape>();

  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const field = selection as FieldNode;
      const fieldName = (field.alias ?? field.name).value;
      const schemaFieldName = field.name.value;

      // Get field type from schema if available
      const schemaField = parentType?.getFields()[schemaFieldName];
      const fieldType = schemaField?.type;

      if (field.selectionSet) {
        // Nested object or array of objects
        let nestedType: GraphQLObjectType | undefined;

        if (fieldType) {
          // Get the named type (unwrap NonNull and List)
          const namedType = getNamedType(fieldType);
          if (isObjectType(namedType)) {
            nestedType = namedType;
          }
        }

        const nestedShape = selectionSetToShape(field.selectionSet, nestedType);

        if (fieldType && isArrayType(fieldType)) {
          // Field returns an array
          properties.set(fieldName, { kind: 'array', itemShape: nestedShape });
        } else {
          properties.set(fieldName, nestedShape);
        }
      } else {
        // Leaf field
        if (fieldType && isArrayType(fieldType)) {
          properties.set(fieldName, { kind: 'array', itemShape: { kind: 'primitive' } });
        } else {
          properties.set(fieldName, { kind: 'primitive' });
        }
      }
    }
    // FragmentSpread and InlineFragment could be handled for more complete support
  }

  return { kind: 'object', properties };
}

/**
 * Extract response shape from GraphQL document content
 * @param content - The GraphQL query/mutation content
 * @param schemaString - Optional GraphQL schema SDL string for accurate type inference
 */
export function inferShapeFromGraphQL(
  content: string,
  schemaString?: string,
): PropertyShape | undefined {
  try {
    const document = parse(content);

    let schema: GraphQLSchema | undefined;
    let rootType: GraphQLObjectType | undefined;

    if (schemaString) {
      try {
        schema = buildSchema(schemaString);
      } catch {
        // Schema parse error - continue without schema
      }
    }

    for (const definition of document.definitions) {
      if (definition.kind === 'OperationDefinition' && definition.selectionSet) {
        // Get the root type based on operation type
        if (schema) {
          if (definition.operation === 'query') {
            rootType = schema.getQueryType() ?? undefined;
          } else if (definition.operation === 'mutation') {
            rootType = schema.getMutationType() ?? undefined;
          }
        }

        const shape = selectionSetToShape(definition.selectionSet, rootType);

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
 */
export function lookupPropertyPath(shape: PropertyShape, path: string[]): LookupResult {
  let current: PropertyShape = shape;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    if (current.kind === 'primitive') {
      return { shape: undefined, error: 'primitive_access', errorAt: i };
    }

    if (current.kind === 'array') {
      // Array access: check for built-in properties or index access
      if (key === 'first' || key === 'last') {
        if (!current.itemShape) {
          return { shape: undefined, error: 'unknown_property', errorAt: i };
        }
        current = current.itemShape;
        continue;
      }
      if (key === 'size') {
        current = { kind: 'primitive', primitiveType: 'number' };
        continue;
      }
      // Numeric index access returns item shape
      if (/^\d+$/.test(key)) {
        if (!current.itemShape) {
          return { shape: undefined, error: 'unknown_property', errorAt: i };
        }
        current = current.itemShape;
        continue;
      }
      // Unknown array property
      return { shape: undefined, error: 'unknown_property', errorAt: i };
    }

    if (current.kind === 'object') {
      const prop = current.properties?.get(key);
      if (prop) {
        current = prop;
        continue;
      }

      return { shape: undefined, error: 'unknown_property', errorAt: i };
    }
  }

  return { shape: current };
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
 * Merge a new property into an existing shape (for hash_assign tracking)
 */
export function mergePropertyIntoShape(
  shape: PropertyShape,
  key: string,
  valueShape: PropertyShape,
): PropertyShape {
  if (shape.kind !== 'object') {
    // Convert to object
    const properties = new Map<string, PropertyShape>();
    properties.set(key, valueShape);
    return { kind: 'object', properties };
  }

  const newProperties = new Map(shape.properties);
  newProperties.set(key, valueShape);
  return { kind: 'object', properties: newProperties };
}
