import { FilterEntry, Parameter, ReturnType, TagEntry } from './types';

/**
 * What a Liquid expression holds, in the vocabulary the docset publishes.
 *
 * `untyped` means UNKNOWN, not "no type". Nothing is ever reported for it — this repository is
 * a CONSUMER of the docset, and a guess in place of a published fact refuses working code.
 *
 * Two members are not filter return types, because an expression can be something a filter
 * never returns:
 *
 * - `range` is deliberately NOT folded into `array`: an Array accepts `x[0] = …` and a range
 *   was only ever measured raising, so `InvalidWriteTarget` needs to tell them apart.
 *   `object` accepts a range, which is where the two rejoin — see `isTypeCompatible`.
 * - `null` is a nil/null literal. Not a valid `@param` type; it exists so a type-mismatch
 *   message can name what was actually written.
 */
export type LiquidType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'range'
  | 'date'
  | 'time'
  | 'null'
  | 'untyped';

/**
 * Docset `return_type.type` spellings this monorepo is willing to act on.
 *
 * EXACT MATCH, and everything absent becomes `untyped`. Mapping a spelling by resemblance
 * would be guessing, and the checks reading this refuse writes. An unrecognised return type
 * costs a missed detection, which is the direction that cannot manufacture a false block.
 *
 * `date` and `time` are here because the runtime raises on a `hash_assign` to either —
 * measured against a live instance. Deliberately ABSENT: `untyped` and `'string, nil'`, whose
 * type depends on the input.
 */
export const DOCSET_TYPES: Readonly<Record<string, LiquidType>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  object: 'object',

  date: 'date',
  time: 'time',

  // LEGACY SPELLINGS, for a docset published before the platform unified its type vocabulary.
  // The writer is strict — `LiquidTypeVocabulary` upstream publishes exactly one name per type
  // — and the shipped `data/filters.json` uses none of these three. They exist for ONE reader:
  // a docset already downloaded to a user's machine, which `platformOSLiquidDocsManager` keeps
  // until the published revision moves. They only ever ADD a mapping, so they cannot cost a
  // false block.
  hash: 'object',
  datetime: 'time',
  'array of arrays': 'array',
};

/**
 * The type names that are both INFERABLE here and writable in a `@param {…}`.
 *
 * Neither caller is asking what the platform allows — that is the docset's published
 * `param_types`, which is wider: an author may also name an object (`{current_user}`) or an
 * array of a type (`{string[]}`), and inference produces neither. These ask the narrower,
 * LOCAL question of what this code can act on:
 *
 * - `findTypeMismatchParams` enforces a declared type only when inference could contradict it.
 * - `backfill-docs` writes an inferred type into the user's file, so it may only write a name
 *   that is also declarable — `@param {null}` and `@param {range}` are not.
 *
 * DERIVED from {@link DOCSET_TYPES} rather than listed, so it cannot become the hand-written
 * copy of the type vocabulary this repository used to keep.
 */
export const DECLARABLE_TYPES: ReadonlySet<LiquidType> = new Set(Object.values(DOCSET_TYPES));

/**
 * The only part of a docset filter entry any of this reads.
 *
 * Structural on purpose, and narrower than the docset's own `ReturnType`: requiring `name`,
 * `description` or `array_value` would stop a caller passing the shape it actually has.
 *
 * `array_value` is unread for a reason rather than an oversight — it is `""` on every shipped
 * filter, so an `array` return never names its element type and nothing may infer one.
 */
export type FilterTypeSource = {
  name: string;
  return_type?: ReadonlyArray<Pick<ReturnType, 'type'>>;
};

/**
 * The single type a filter returns, or `untyped` when that cannot be established.
 *
 * A filter declaring SEVERAL return types is an enum-like union; it resolves only when
 * every branch maps to the same thing, because a union of "string or nil" is not a string
 * for the purpose of refusing a write.
 */
export function docsetReturnType(filter: FilterTypeSource): LiquidType {
  const returnTypes = filter.return_type;
  if (!returnTypes || returnTypes.length === 0) return 'untyped';

  const mapped = new Set(returnTypes.map((entry) => DOCSET_TYPES[entry.type] ?? 'untyped'));
  const [only] = mapped;
  return mapped.size === 1 ? only : 'untyped';
}

/**
 * Return type by filter name, built once per docset rather than per file.
 *
 * `platformosDocset.filters()` is memoized by `AugmentedPlatformOSDocset`, so the array
 * identity is stable for a run and can key the cache — the alternative is a linear scan of
 * ~200 entries for every filter in every file.
 *
 * A filter whose type does not resolve gets NO ROW: `untyped` is what a missing row means.
 */
const RETURN_TYPES_BY_DOCSET = new WeakMap<
  readonly FilterEntry[],
  ReadonlyMap<string, LiquidType>
>();

export function filterReturnTypes(
  filters: readonly FilterEntry[],
): ReadonlyMap<string, LiquidType> {
  const cached = RETURN_TYPES_BY_DOCSET.get(filters);
  if (cached) return cached;

  const types = new Map<string, LiquidType>();
  for (const filter of filters) {
    const type = docsetReturnType(filter);
    if (type !== 'untyped') types.set(filter.name, type);
  }

  RETURN_TYPES_BY_DOCSET.set(filters, types);
  return types;
}

/**
 * The type a TAG leaves in the variable it assigns, by tag name — the tag counterpart of
 * {@link filterReturnTypes}, resolved through the same {@link docsetReturnType}.
 *
 * `tags.json` carries `return_type` under the same name filters use, so a tag that documents
 * what it produces is read here with no new vocabulary. Every shipped entry publishes `[]` for
 * it today, so this map is EMPTY against the current document and every tag-assigned variable
 * is `untyped`.
 *
 * That is the design rather than a gap to work around: the same was true of `tagParameterTypes`
 * while the documentation site published a hardcoded `"untyped"`, and the day that was fixed
 * `ValidTagArgumentTypes` went from typing 5 of 72 parameters to 69 with no edit here.
 */
const TAG_RETURN_TYPES_BY_DOCSET = new WeakMap<
  readonly TagEntry[],
  ReadonlyMap<string, LiquidType>
>();

export function tagReturnTypes(tags: readonly TagEntry[]): ReadonlyMap<string, LiquidType> {
  const cached = TAG_RETURN_TYPES_BY_DOCSET.get(tags);
  if (cached) return cached;

  const types = new Map<string, LiquidType>();
  for (const tag of tags) {
    const type = docsetReturnType(tag);
    // A CONTRADICTION is not a fact, for the reason `tagParameterTypes` states: `tags.json` ships
    // two entries named `else` and has no merge upstream, so a plain last-wins reduce would let
    // row order decide. Two rows disagreeing leaves no row, which is what `untyped` already means.
    if (type === 'untyped') continue;
    const existing = types.get(tag.name);
    if (existing === undefined) types.set(tag.name, type);
    else if (existing !== type) types.set(tag.name, 'untyped');
  }
  for (const [name, type] of [...types]) if (type === 'untyped') types.delete(name);

  TAG_RETURN_TYPES_BY_DOCSET.set(tags, types);
  return types;
}

/**
 * The single type a documented ARGUMENT accepts, or `untyped` when that cannot be established.
 *
 * Same resolution as {@link docsetReturnType}, on the other end of the call: several published
 * types is a union, and a union only resolves when every branch maps to the same thing.
 */
export function docsetParameterType(parameter: Pick<Parameter, 'types'>): LiquidType {
  const [only, ...rest] = docsetParameterTypes(parameter);

  return rest.length === 0 ? only : 'untyped';
}

/**
 * EVERY type a documented argument accepts, for a reader that can act on more than one.
 *
 * A parameter may name a set the implementation enumerates — `strftime` takes a string, a
 * number of seconds, a Date or a Time and raises on anything else, measured — and the published
 * `types` array carries all four. A value is wrong there only when it matches NONE of them.
 *
 * ONE UNRECOGNISED BRANCH COLLAPSES THE WHOLE SET to `untyped`: the union names something this
 * repository cannot place, so "anything is accepted" is the only reading that cannot refuse
 * working code. {@link docsetParameterType} is this answer narrowed to a single type for a
 * caller with nowhere to put a union.
 */
export function docsetParameterTypes(parameter: Pick<Parameter, 'types'>): readonly LiquidType[] {
  const types = parameter.types;
  if (!types || types.length === 0) return ['untyped'];

  const mapped = types.map((name) => DOCSET_TYPES[name] ?? 'untyped');
  if (mapped.includes('untyped')) return ['untyped'];

  return [...new Set(mapped)];
}

/**
 * Argument types by tag name, built once per docset — the tag counterpart of
 * {@link filterReturnTypes}.
 *
 * A parameter whose type does not resolve gets NO ROW, and neither does a tag left with no
 * typed parameter: `untyped` is what a missing row means. How much that leaves is the
 * document's business, and a consumer stays silent about what the platform has not published.
 *
 * ROW ORDER MUST NOT DECIDE THE ANSWER, for the reason `filtersMap` states: `tags.json` ships
 * two entries named `else` and has no merge upstream, so a plain last-wins reduce would let
 * whichever row the docs site lists second erase the other's. Two rules keep the answer the
 * same whichever order the file arrives in:
 *
 * - A duplicate ADDS. A parameter one row types and the other leaves `untyped` keeps the type.
 * - A CONTRADICTION is not a fact. Two rows typing the same parameter differently leaves it
 *   with no row at all, which is what `untyped` already means.
 */
const PARAMETER_TYPES_BY_DOCSET = new WeakMap<
  readonly TagEntry[],
  ReadonlyMap<string, ReadonlyMap<string, LiquidType>>
>();

export function tagParameterTypes(
  tags: readonly TagEntry[],
): ReadonlyMap<string, ReadonlyMap<string, LiquidType>> {
  const cached = PARAMETER_TYPES_BY_DOCSET.get(tags);
  if (cached) return cached;

  const byTag = new Map<string, Map<string, LiquidType>>();
  const contradicted = new Map<string, Set<string>>();

  for (const tag of tags) {
    for (const parameter of tag.parameters ?? []) {
      const type = docsetParameterType(parameter);
      if (type === 'untyped') continue;

      let parameters = byTag.get(tag.name);
      if (!parameters) {
        parameters = new Map();
        byTag.set(tag.name, parameters);
      }

      const existing = parameters.get(parameter.name);
      if (existing === undefined) {
        parameters.set(parameter.name, type);
      } else if (existing !== type) {
        const names = contradicted.get(tag.name) ?? new Set<string>();
        names.add(parameter.name);
        contradicted.set(tag.name, names);
      }
    }
  }

  for (const [tagName, names] of contradicted) {
    const parameters = byTag.get(tagName)!;
    for (const name of names) parameters.delete(name);
    if (parameters.size === 0) byTag.delete(tagName);
  }

  PARAMETER_TYPES_BY_DOCSET.set(tags, byTag);
  return byTag;
}

/** One documented argument of a filter, resolved to what a consumer can act on. */
export interface FilterParameter {
  name: string;
  /**
   * Every type the argument accepts, and a value is wrong only when it matches none of them.
   *
   * `['untyped']` where the docset makes no claim, and then nothing may be reported about it — it is
   * never one branch among several, see {@link docsetParameterTypes}.
   */
  types: readonly LiquidType[];
  /** False for an argument written `name: value`. Absent in the document means positional. */
  positional: boolean;
  /**
   * Whether the argument absorbs every remaining one.
   *
   * The published type then describes the COLLECTION while each argument written at the call site is
   * an ELEMENT of it: `hash_dig.keys` is `array`, and `{{ h | dig: 'a', 'b' }}` writes two strings.
   * Comparing a written argument against `array` there reported seven correct calls in four projects.
   */
  variadic: boolean;
}

const FILTER_PARAMETERS_BY_DOCSET = new WeakMap<
  readonly FilterEntry[],
  ReadonlyMap<string, readonly FilterParameter[]>
>();

/**
 * The documented arguments of every filter, in signature order, built once per docset.
 *
 * PARAMETER 0 IS THE PIPED VALUE — upstream derives the list from the Ruby signature, where
 * the input is the first argument, and `arity` counts it as one. So
 * `{{ 123 | hash_add_key: 'k', v }}` is checked against `hash`, `key`, `value` in that order.
 *
 * Unlike {@link tagParameterTypes} this keeps `untyped` rows: a caller matching a WRITTEN
 * argument to a parameter needs the positions to line up.
 */
export function filterParameterTypes(
  filters: readonly FilterEntry[],
): ReadonlyMap<string, readonly FilterParameter[]> {
  const cached = FILTER_PARAMETERS_BY_DOCSET.get(filters);
  if (cached) return cached;

  const byFilter = new Map<string, readonly FilterParameter[]>();

  for (const filter of filters) {
    if (!filter.parameters?.length) continue;

    byFilter.set(
      filter.name,
      filter.parameters.map((parameter) => ({
        name: parameter.name,
        types: docsetParameterTypes(parameter),
        positional: parameter.positional !== false,
        variadic: parameter.variadic === true,
      })),
    );
  }

  FILTER_PARAMETERS_BY_DOCSET.set(filters, byFilter);
  return byFilter;
}

/**
 * Whether this docset's filter argument types may be read as CONTRACTS — "the filter refuses
 * anything else" — rather than as "the type a template usually passes".
 *
 * THE MARKER IS THE PRESENCE OF `untyped` ON ANY FILTER PARAMETER, and it is a marker rather
 * than a version number because it is the same fact: until the platform had that spelling,
 * every parameter accepting several types was published as `object` — the same token
 * `hash_add_key` uses for a Hash it raises without. Reading either as a contract reported 1,279
 * offenses across four production projects with not one real among them.
 *
 * So a docset published before the separation makes NO argument-type claim this repository will
 * act on. Measured after it: 123 of 417 filter parameters are `untyped`, including every
 * parameter of every core Liquid filter, because those coerce instead of refusing.
 */
export function filterTypesAreContracts(filters: readonly FilterEntry[]): boolean {
  const cached = CONTRACTS_BY_DOCSET.get(filters);
  if (cached !== undefined) return cached;

  // The literal SPELLING, not `docsetParameterType`, which also answers `untyped` for a parameter
  // with no types at all and for a name it does not recognise. Neither is the platform saying
  // "several types are accepted here", and reading an unannotated parameter as the marker would turn
  // the whole check on against a docset that cannot support it.
  const separated = filters.some((filter) =>
    filter.parameters?.some((parameter) => parameter.types?.includes('untyped')),
  );

  CONTRACTS_BY_DOCSET.set(filters, separated);
  return separated;
}

const CONTRACTS_BY_DOCSET = new WeakMap<readonly FilterEntry[], boolean>();

/**
 * Whether a value of `actualType` may be passed where a filter parameter accepts `expected`.
 *
 * NOT `isTypeCompatible`, and the whole difference is `object`. That one widens `object` to
 * accept an array and a range, which is right for a `{% doc %}` `@param {object}` and wrong for
 * a filter, where `object` is the Hash spelling and the runtime says so: measured,
 * `{{ [] | hash_add_key: 'hello', 'world' }}` and kin each raise `first argument must be a
 * hash`, while `{% assign h = {} %}` piped into the same call renders. A filter that genuinely
 * takes either publishes BOTH.
 *
 * `boolean` still accepts every value, for the reason it does everywhere: every value in Liquid
 * is truthy or falsy.
 */
export function isFilterArgumentCompatible(expected: LiquidType, actualType: LiquidType): boolean {
  if (expected === 'untyped' || actualType === 'untyped' || actualType === 'null') return true;
  if (expected === 'boolean') return true;

  return expected === actualType;
}

/**
 * What a chain of filters produces, or `untyped` when the docset cannot say.
 *
 * THE LAST FILTER DECIDES: every earlier one is input to the next. One resolution shared by
 * every consumer, so no caller can invent its own precedence.
 *
 * A list of filter names must never be reintroduced beside this. A hand-written table has no
 * way to look wrong — a name in the wrong bucket is a blocking refusal of working code.
 */
export function filterChainType(
  filters: readonly { name: string }[],
  returnTypes: ReadonlyMap<string, LiquidType> | undefined,
): LiquidType {
  const last = filters[filters.length - 1];
  if (!last) return 'untyped';
  return returnTypes?.get(last.name) ?? 'untyped';
}
