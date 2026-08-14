import {
  ComplexLiquidExpression,
  LiquidExpression,
  LiquidVariable,
  NodeTypes,
} from '@platformos/liquid-html-parser';
import { getFileType, PlatformOSFileType } from '@platformos/platformos-common';
import { assertNever } from '../utils';
import { LiquidDocParamTypeEntry, ObjectEntry, UriString } from '../types';
import { DECLARABLE_TYPES, filterChainType, LiquidType } from '../liquid-types';

/**
 * Narrow an inferred type to something an author could have DECLARED.
 *
 * For the one consumer that writes its answer into a user's file — `backfill-docs`, which
 * synthesizes a `{% doc %}` block from call sites. `@param {untyped}` and `@param {null}` are not
 * types anyone can write, and `ValidDocParamTypes` would report the file the moment it was
 * generated. `object` is the documented generic, so it is where everything unnameable lands.
 *
 * {@link DECLARABLE_TYPES} is the authority, and it is derived from the docset's own type spellings
 * rather than listed here — this function used to be a switch over a local enum of five names, which
 * is how `date` and `time` came to be uninferable in a docblock while the platform published both.
 */
export function declarableParamType(type: LiquidType): LiquidType {
  return DECLARABLE_TYPES.has(type) ? type : 'object';
}

/**
 * Provides a default completion value for an argument / parameter of a given type.
 *
 * BEHAVIOUR keyed by type name, not a list of them: a type with no sensible literal — `object`,
 * `date`, an object name, anything the docset adds later — falls through to the empty string, and
 * `generateTypeMismatchSuggestions` then offers no "replace with default" fix at all.
 */
export function getDefaultValueForType(type: string | null) {
  switch (type?.toLowerCase()) {
    case 'string':
      return "''";
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    default:
      return '';
  }
}

/**
 * The type of a value written at a call site.
 *
 * `returnTypes` is the docset's filter → return type map ({@link filterReturnTypes}). A caller
 * that passes one gets a filtered expression resolved — `y | append: '!'` is a `string`, because
 * the platform says `append` returns one. A caller that passes nothing gets `untyped` for anything
 * filtered, which is the honest answer when the docset was never consulted.
 *
 * A bare `VariableLookup` is `object` rather than `untyped` because there is no symbol table here;
 * the checks that must not act on an unknown value skip a lookup BEFORE asking, so this answer only
 * reaches the doc-backfill caller, whose fallback it already was.
 */
export function inferArgumentType(
  arg: LiquidExpression | LiquidVariable,
  returnTypes?: ReadonlyMap<string, LiquidType>,
): LiquidType {
  if (arg.type === NodeTypes.LiquidVariable) {
    if (arg.filters.length > 0) return filterChainType(arg.filters, returnTypes);
    const expr = arg.expression;
    // Conservatively `object`, NOT `boolean`. A comparison is a boolean, but saying so would
    // start reporting `@param {object}` arguments that have never been reported, and no part of
    // this change is meant to add an offense class.
    if (expr.type === NodeTypes.BooleanExpression) return 'object';
    return inferArgumentType(expr, returnTypes);
  }
  switch (arg.type) {
    case NodeTypes.String:
      return 'string';
    case NodeTypes.Number:
      return 'number';
    case NodeTypes.LiquidLiteral:
      if (arg.value === null) return 'null';
      if (arg.value === '') return 'string';
      return 'boolean';
    case NodeTypes.JsonArrayLiteral:
      return 'array';
    case NodeTypes.Range:
      return 'range';
    case NodeTypes.VariableLookup:
    case NodeTypes.JsonHashLiteral:
      return 'object';
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
 * Whether a value of `actualType` satisfies a parameter declared as `expectedType`.
 *
 * THE ONE COMPATIBILITY RULE, stated once so no call site can invent its own:
 *
 * - An unknown value satisfies everything. `untyped` is "the docset does not say" and `null` is
 *   "no value at all"; reporting either would be a guess, and these checks are read as gates.
 *   This arm is also what keeps a filtered expression quiet when the filter is one the docset
 *   has never heard of — a module's own filter, or anything newer than the downloaded docset.
 * - Boolean accepts any value, since everything is truthy / falsy in Liquid.
 * - Object accepts an array and a range, since it is documented as the generic non-primitive type.
 */
export function isTypeCompatible(expectedType: string, actualType: LiquidType): boolean {
  const normalizedExpectedType = expectedType.toLowerCase();

  if (actualType === 'untyped' || actualType === 'null') {
    return true;
  }

  if (normalizedExpectedType === 'boolean') {
    return true;
  }

  if (normalizedExpectedType === 'object' && (actualType === 'array' || actualType === 'range')) {
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
 * Every type an author may write in `@param {…}`, with the prose to show beside it.
 *
 * The union of two published documents and nothing else: the `{% doc %}` vocabulary's `param_types`
 * (`string`, `number`, `date`, …) and the name of every object a value can be an instance of. The five
 * type names and their descriptions used to be written here, which is how they came to be five while
 * the platform published seven.
 *
 * `undefined` — NOT an empty map — when the docset publishes no param types, which is every docset
 * older than `liquid_doc.json`. The two answers are not the same and no caller may conflate them: an
 * empty set of valid types would make `ValidDocParamTypes` report every `@param {string}` in the
 * project, so each caller has to decide what "the docset does not say" means for it. They all decide
 * the same way — do nothing — but they decide it explicitly.
 */
export function getValidParamTypes(
  publishedTypes: LiquidDocParamTypeEntry[],
  objectEntries: ObjectEntry[],
): Map<string, string | undefined> | undefined {
  if (publishedTypes.length === 0) return undefined;

  const paramTypes = new Map<string, string | undefined>(
    publishedTypes.map((type) => [type.name, type.description]),
  );

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
