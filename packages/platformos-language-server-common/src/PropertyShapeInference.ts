import { parse, SelectionSetNode, FieldNode } from 'graphql/language';
import {
  buildSchema,
  GraphQLSchema,
  GraphQLObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  getNamedType,
  GraphQLOutputType,
} from 'graphql';
import { parseJSON, isError } from '@platformos/platformos-check-common';
import {
  JsonHashLiteral,
  JsonArrayLiteral,
  LiquidExpression,
  LiquidVariable,
  NodeTypes,
} from '@platformos/liquid-html-parser';

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
export function mergeShapes(a: PropertyShape, b: PropertyShape): PropertyShape {
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
 * Optional callback to resolve expressions the shape inferrer can't handle
 * (e.g. variable lookups that require the type system).
 */
export type ExpressionShapeResolver = (expr: LiquidExpression) => PropertyShape | undefined;

/**
 * Infer shape from a JSON literal AST node (JsonHashLiteral or JsonArrayLiteral).
 * This mirrors inferShapeFromJSON but walks AST nodes instead of parsed JS values.
 *
 * @param resolveExpression - Optional callback to resolve variable references and
 *   other expressions that require type system context.
 */
export function inferShapeFromJsonLiteral(
  node: JsonHashLiteral | JsonArrayLiteral,
  resolveExpression?: ExpressionShapeResolver,
): PropertyShape {
  if (node.type === NodeTypes.JsonHashLiteral) {
    const properties = new Map<string, PropertyShape>();
    for (const entry of node.entries) {
      const key = getJsonKeyName(entry.key);
      if (key !== undefined) {
        properties.set(key, inferShapeFromExpression(entry.value, resolveExpression));
      }
    }
    return { kind: 'object', properties };
  }

  // JsonArrayLiteral
  let itemShape: PropertyShape | undefined;
  for (const element of node.elements) {
    const shape = inferShapeFromExpression(element, resolveExpression);
    itemShape = itemShape ? mergeShapes(itemShape, shape) : shape;
  }
  return { kind: 'array', itemShape };
}

function getJsonKeyName(key: LiquidExpression): string | undefined {
  switch (key.type) {
    case NodeTypes.String:
      return key.value;
    case NodeTypes.VariableLookup:
      return key.name ?? undefined;
    default:
      return undefined;
  }
}

function inferShapeFromExpression(
  expr: LiquidExpression | LiquidVariable,
  resolveExpression?: ExpressionShapeResolver,
): PropertyShape {
  if (expr.type === NodeTypes.LiquidVariable) {
    // A filtered expression's output type can't be statically inferred
    return { kind: 'primitive' };
  }
  switch (expr.type) {
    case NodeTypes.JsonHashLiteral:
    case NodeTypes.JsonArrayLiteral:
      return inferShapeFromJsonLiteral(expr, resolveExpression);
    case NodeTypes.String:
      return { kind: 'primitive', primitiveType: 'string' };
    case NodeTypes.Number:
      return { kind: 'primitive', primitiveType: 'number' };
    case NodeTypes.LiquidLiteral:
      if (expr.value === null) return { kind: 'primitive', primitiveType: 'null' };
      if (typeof expr.value === 'boolean') return { kind: 'primitive', primitiveType: 'boolean' };
      return { kind: 'primitive' };
    default:
      return resolveExpression?.(expr) ?? { kind: 'primitive' };
  }
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
          const namedType = getNamedType(fieldType);
          if (isObjectType(namedType)) {
            nestedType = namedType;
          }
        }

        const nestedShape = selectionSetToShape(field.selectionSet, nestedType);

        if (fieldType && isArrayType(fieldType)) {
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
        if (schema) {
          if (definition.operation === 'query') {
            rootType = schema.getQueryType() ?? undefined;
          } else if (definition.operation === 'mutation') {
            rootType = schema.getMutationType() ?? undefined;
          }
        }

        return selectionSetToShape(definition.selectionSet, rootType);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Look up a property path in a shape, returning the shape at that path.
 */
export function lookupPropertyPath(shape: PropertyShape, path: string[]): LookupResult {
  let current: PropertyShape = shape;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];

    if (current.kind === 'primitive') {
      return { shape: undefined, error: 'primitive_access', errorAt: i };
    }

    if (current.kind === 'array') {
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
      if (/^\d+$/.test(key)) {
        if (!current.itemShape) {
          return { shape: undefined, error: 'unknown_property', errorAt: i };
        }
        current = current.itemShape;
        continue;
      }
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

export interface PropertyWithType {
  name: string;
  type: string;
  detail: string;
}

/**
 * Convert a PropertyShape to a human-readable type string
 */
export function shapeToTypeString(shape: PropertyShape): string {
  if (shape.kind === 'primitive') {
    return shape.primitiveType ?? 'any';
  }
  if (shape.kind === 'array') {
    if (shape.itemShape) {
      return `${shapeToTypeString(shape.itemShape)}[]`;
    }
    return 'array';
  }
  if (shape.kind === 'object') {
    return 'object';
  }
  return 'any';
}

const MAX_KEYS_TO_SHOW = 5;

/**
 * Convert a PropertyShape to a detailed multi-line description
 */
export function shapeToDetailString(shape: PropertyShape): string {
  const typeStr = shapeToTypeString(shape);
  const lines: string[] = [`Type: ${typeStr}`];

  if (shape.kind === 'object' && shape.properties && shape.properties.size > 0) {
    const keys = Array.from(shape.properties.keys());
    if (keys.length <= MAX_KEYS_TO_SHOW) {
      lines.push(`Keys: ${keys.join(', ')}`);
    } else {
      const shown = keys.slice(0, MAX_KEYS_TO_SHOW).join(', ');
      lines.push(`Keys: ${shown}, ... (+${keys.length - MAX_KEYS_TO_SHOW} more)`);
    }
  }

  if (shape.kind === 'array' && shape.itemShape) {
    if (
      shape.itemShape.kind === 'object' &&
      shape.itemShape.properties &&
      shape.itemShape.properties.size > 0
    ) {
      const keys = Array.from(shape.itemShape.properties.keys());
      if (keys.length <= MAX_KEYS_TO_SHOW) {
        lines.push(`Item keys: ${keys.join(', ')}`);
      } else {
        const shown = keys.slice(0, MAX_KEYS_TO_SHOW).join(', ');
        lines.push(`Item keys: ${shown}, ... (+${keys.length - MAX_KEYS_TO_SHOW} more)`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get available properties with their types at a given shape (for autocomplete)
 */
export function getAvailablePropertiesWithTypes(shape: PropertyShape): PropertyWithType[] {
  if (shape.kind === 'object' && shape.properties) {
    return Array.from(shape.properties.entries()).map(([name, propShape]) => ({
      name,
      type: shapeToTypeString(propShape),
      detail: shapeToDetailString(propShape),
    }));
  }
  if (shape.kind === 'array') {
    const itemType = shape.itemShape ? shapeToTypeString(shape.itemShape) : 'any';
    const itemDetail = shape.itemShape ? shapeToDetailString(shape.itemShape) : 'Type: any';
    return [
      { name: 'first', type: itemType, detail: itemDetail },
      { name: 'last', type: itemType, detail: itemDetail },
      { name: 'size', type: 'number', detail: 'Type: number' },
    ];
  }
  if (shape.kind === 'primitive' && shape.primitiveType === 'string') {
    return [{ name: 'size', type: 'number', detail: 'Type: number' }];
  }
  return [];
}

/**
 * Merge a new property into an existing shape
 */
export function mergePropertyIntoShape(
  shape: PropertyShape,
  key: string,
  valueShape: PropertyShape,
): PropertyShape {
  if (shape.kind !== 'object') {
    const properties = new Map<string, PropertyShape>();
    properties.set(key, valueShape);
    return { kind: 'object', properties };
  }

  const newProperties = new Map(shape.properties);
  newProperties.set(key, valueShape);
  return { kind: 'object', properties: newProperties };
}
