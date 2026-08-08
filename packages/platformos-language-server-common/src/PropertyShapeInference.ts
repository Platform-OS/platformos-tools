import {
  JsonArrayLiteral,
  JsonHashLiteral,
  LiquidExpression,
  LiquidVariable,
  NodeTypes,
} from '@platformos/liquid-html-parser';
import {
  PropertyShape,
  UNKNOWN_SHAPE,
  foldAlternatives,
  objectShape,
  primitiveShapeOfLiteral,
} from '@platformos/platformos-check-common';

/**
 * Shape PRESENTATION, for hover and completion.
 *
 * The shapes themselves — the type, the JSON/GraphQL inference, the path lookup, the
 * merge rules — come from check-common (`checks/unknown-property/property-shape.ts`).
 * Do not re-derive any of them here: what is left in this module is only what a
 * diagnostic has no use for.
 */
export {
  PropertyShape,
  getAvailableProperties,
  inferShapeFromGraphQL,
  inferShapeFromJSON,
  inferShapeFromJSONString,
  lookupPropertyPath,
  type LookupResult,
} from '@platformos/platformos-check-common';

/**
 * Optional callback to resolve expressions the shape inferrer can't handle
 * (e.g. variable lookups that require the type system).
 */
export type ExpressionShapeResolver = (expr: LiquidExpression) => PropertyShape | undefined;

/**
 * The resolver is how a docset type reaches a literal — `{ "user": context.current_user }`
 * gets `current_user`'s documented properties, which no diagnostic has a use for.
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
    return objectShape(properties);
  }

  const items = node.elements.map((element) =>
    inferShapeFromExpression(element, resolveExpression),
  );
  return { kind: 'array', itemShape: foldAlternatives(items) };
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
    // A filtered expression's output structure is not knowable statically.
    return UNKNOWN_SHAPE;
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
      return primitiveShapeOfLiteral(expr.value);
    default:
      return resolveExpression?.(expr) ?? UNKNOWN_SHAPE;
  }
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
 * Map a PropertyShape to a JSON literal placeholder string suitable for
 * substituting a {{ expr | json }} expression during static analysis.
 */
export function shapeToJSONPlaceholder(shape: PropertyShape | undefined): string {
  if (!shape) return 'null';
  switch (shape.kind) {
    case 'primitive':
      switch (shape.primitiveType) {
        case 'string':
          return '""';
        case 'number':
          return '0';
        case 'boolean':
          return 'true';
        default:
          return 'null';
      }
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    default:
      return 'null';
  }
}
