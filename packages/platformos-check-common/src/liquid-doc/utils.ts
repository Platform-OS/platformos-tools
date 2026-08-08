import {
  ComplexLiquidExpression,
  LiquidExpression,
  LiquidVariable,
  NodeTypes,
} from '@platformos/liquid-html-parser';
import { getFileType, PlatformOSFileType } from '@platformos/platformos-common';
import { assertNever } from '../utils';
import { ObjectEntry, UriString } from '../types';

/**
 * The base set of supported param types for LiquidDoc.
 *
 * This is used in conjunction with objects defined in [liquid docs](https://documentation.platformos.com/api-reference/liquid/objects)
 * to determine ALL supported param types for LiquidDoc.
 *
 * References `getValidParamTypes`
 */
export enum BasicParamTypes {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Object = 'object',
  Array = 'array',
}

/** Inferred type for null/nil literals — not a valid @param type, only used in type mismatch messages. */
export const InferredNull = 'null' as const;

export type InferredParamType = BasicParamTypes | typeof InferredNull;

export enum SupportedDocTagTypes {
  Param = 'param',
  Example = 'example',
  Description = 'description',
}

/**
 * Provides a default completion value for an argument / parameter of a given type.
 */
export function getDefaultValueForType(type: string | null) {
  switch (type?.toLowerCase()) {
    case BasicParamTypes.String:
      return "''";
    case BasicParamTypes.Number:
      return '0';
    case BasicParamTypes.Boolean:
      return 'false';
    case BasicParamTypes.Array:
      return '[]';
    case BasicParamTypes.Object: // Objects don't have a sensible default value
    default:
      return '';
  }
}

/**
 * Casts the value of a LiquidNamedArgument to a string representing the type of the value.
 */
export function inferArgumentType(arg: LiquidExpression | LiquidVariable): InferredParamType {
  if (arg.type === NodeTypes.LiquidVariable) {
    // A variable with filters — delegate to the base expression if there are no filters,
    // otherwise we can't statically determine the filtered output type.
    if (arg.filters.length > 0) return BasicParamTypes.Object;
    const expr = arg.expression;
    if (expr.type === NodeTypes.BooleanExpression) return BasicParamTypes.Object;
    return inferArgumentType(expr);
  }
  switch (arg.type) {
    case NodeTypes.String:
      return BasicParamTypes.String;
    case NodeTypes.Number:
      return BasicParamTypes.Number;
    case NodeTypes.LiquidLiteral:
      if (arg.value === null) return InferredNull;
      if (arg.value === '') return BasicParamTypes.String;
      return BasicParamTypes.Boolean;
    case NodeTypes.JsonArrayLiteral:
      return BasicParamTypes.Array;
    case NodeTypes.Range:
    case NodeTypes.VariableLookup:
    case NodeTypes.JsonHashLiteral:
      return BasicParamTypes.Object;
    default:
      // This ensures that we have a case for every possible type for arg.value
      return assertNever(arg);
  }
}

/**
 * Checks if a LiquidExpression is a null/nil literal.
 * null/nil is compatible with any type — it represents "no value".
 */
export function isNullLiteral(arg: ComplexLiquidExpression | LiquidVariable): boolean {
  if (arg.type === NodeTypes.LiquidVariable) {
    if (arg.filters.length > 0) return false;
    return isNullLiteral(arg.expression);
  }
  if (arg.type === NodeTypes.LiquidLiteral) {
    return arg.value === null;
  }
  return false;
}

/**
 * Checks if the provided argument type is compatible with the expected type.
 * Makes certain types more permissive:
 * - Boolean accepts any value, since everything is truthy / falsy in Liquid
 * - Object accepts an array, since it is documented as the generic non-primitive type
 */
export function isTypeCompatible(expectedType: string, actualType: InferredParamType): boolean {
  const normalizedExpectedType = expectedType.toLowerCase();

  if (normalizedExpectedType === BasicParamTypes.Boolean) {
    return true;
  }

  if (normalizedExpectedType === BasicParamTypes.Object && actualType === BasicParamTypes.Array) {
    return true;
  }

  return normalizedExpectedType === actualType;
}

/**
 * Checks if the provided file path supports the LiquidDoc tag.
 */
export function filePathSupportsLiquidDoc(uri: UriString, rootUri: UriString) {
  return fileTypeSupportsLiquidDoc(getFileType(uri, rootUri));
}

/**
 * Whether `{% doc %}` applies to a file of `fileType` — partials only. The
 * TYPE-level spelling of {@link filePathSupportsLiquidDoc}, for a caller that
 * already classified the file (the language server's `DocumentManager.fileType`)
 * and must not re-derive what it holds.
 */
export function fileTypeSupportsLiquidDoc(fileType: PlatformOSFileType | undefined): boolean {
  return fileType === PlatformOSFileType.Partial;
}

/**
 * Dynamically generates a map of LiquidDoc param types using object entries from
 * [liquid docs](https://documentation.platformos.com/api-reference/liquid/objects).
 *
 * This is used in conjunction with the base set of supported param.
 *
 * References `BasicParamTypes`
 */
export function getValidParamTypes(objectEntries: ObjectEntry[]): Map<string, string | undefined> {
  const paramTypes: Map<string, string | undefined> = new Map([
    [BasicParamTypes.String, undefined],
    [BasicParamTypes.Number, undefined],
    [BasicParamTypes.Boolean, undefined],
    [
      BasicParamTypes.Object,
      'A generic type used to represent any liquid object or primitive value.',
    ],
    [BasicParamTypes.Array, 'A generic type used to represent an array of any values.'],
  ]);

  objectEntries.forEach((obj) => paramTypes.set(obj.name, obj.summary || obj.description));

  return paramTypes;
}

export function parseParamType(
  validParamTypes: Set<string>,
  value: string,
): [pseudoType: string, isArray: boolean] | undefined {
  const paramTypeMatch = value.match(/^([a-z_]+)(\[\])?$/);

  if (!paramTypeMatch) return undefined;

  const extractedParamType = paramTypeMatch[1];
  const isArrayType = !!paramTypeMatch[2];

  if (!validParamTypes.has(extractedParamType)) return undefined;

  return [extractedParamType, isArrayType];
}
