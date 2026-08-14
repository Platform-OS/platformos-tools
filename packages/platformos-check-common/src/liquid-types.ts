import { FilterEntry, Parameter, ReturnType, TagEntry } from './types';

/**
 * What a Liquid expression holds, in the vocabulary the docset publishes.
 *
 * `untyped` means UNKNOWN, not "no type". Nothing is ever reported for it — every check
 * downstream treats it as compatible with whatever was expected, because this repository
 * is a CONSUMER of the docset and a guess in place of a published fact refuses working
 * code.
 *
 * Two members are not filter return types and exist because an expression can be
 * something a filter never returns:
 *
 * - `range` is deliberately NOT folded into `array`. An Array accepts `x[0] = …` and a
 *   range was only ever measured raising, so `InvalidHashAssignTarget` needs to tell them
 *   apart. `object` accepts a range, which is where the two rejoin — see
 *   `isTypeCompatible`.
 * - `null` is a nil/null literal. It is not a valid `@param` type; it exists so a type
 *   mismatch message can name what was actually written.
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
 * EXACT MATCH, and everything absent from this table becomes `untyped`. Mapping a
 * spelling by resemblance would be guessing, and the checks reading this refuse writes —
 * a wrong guess here is a refusal of working code. An unrecognised return type costs a
 * missed detection, which is the direction that cannot manufacture a false block.
 *
 * `date` and `time` are here because the runtime raises on a `hash_assign` to either —
 * measured against a live instance, and the reason those two spellings are not simply
 * left `untyped`.
 *
 * Deliberately ABSENT: `untyped` and `'string, nil'` — values whose type depends on the
 * input, where silence is the only safe reading.
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
  //
  // This table READS a document it does not control, and the strictness belongs at the other end:
  // `LiquidTypeVocabulary` in the application repository is the writer, and it publishes exactly one
  // name per type — `object`, never `hash`; `array[]` with the element type in `array_value`, never
  // the prose `array of arrays`; `time`, never `datetime`. The shipped `data/filters.json` is on the
  // unified vocabulary now and uses none of these three, so they exist for ONE reader: a docset
  // already downloaded to a user's machine, which `platformOSLiquidDocsManager` keeps until the
  // published revision moves. Dropping them would blind the checks against those copies and gain
  // nothing; keeping them cannot cost a false block, since they only ever ADD a mapping.
  hash: 'object',
  datetime: 'time',
  'array of arrays': 'array',
};

/**
 * The type names that are both INFERABLE here and writable in a `@param {…}`.
 *
 * Two callers need it, and neither is asking what the platform allows — that answer belongs to the
 * docset's published `param_types`, which is wider than this: an author may also name an object
 * (`{current_user}`) or an array of a type (`{string[]}`), and neither is anything inference produces.
 * These two ask the narrower, LOCAL question of what this code can act on:
 *
 * - `findTypeMismatchParams` enforces a declared type only when inference could contradict it. A
 *   `{current_user}` argument is left alone because nothing here knows what satisfies one.
 * - `backfill-docs` writes an inferred type into the user's file, so it may only write a name that
 *   is also declarable — `@param {null}` and `@param {range}` are not, and `{% render 'x', t: nil %}`
 *   used to generate exactly the first one.
 *
 * DERIVED from {@link DOCSET_TYPES} rather than listed, which is what keeps it from becoming the
 * hand-written copy of the type vocabulary this repository used to keep. A name is here exactly when
 * a published return type maps onto it, so `range`, `null` and `untyped` — the three members no
 * document ever names — are absent for a reason rather than by omission.
 */
export const DECLARABLE_TYPES: ReadonlySet<LiquidType> = new Set(Object.values(DOCSET_TYPES));

/**
 * The only part of a docset filter entry any of this reads.
 *
 * Structural on purpose, and narrower than the docset's own `ReturnType`: nothing here
 * looks at `name`, `description` or `array_value` on a return type, so requiring them
 * would stop a caller passing the shape it actually has.
 *
 * `array_value` is unread for a reason rather than an oversight — it is `""` on every one
 * of the shipped filters, so an `array` return never names its element type and nothing
 * may infer one.
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
 * `platformosDocset.filters()` is memoized by `AugmentedPlatformOSDocset`, so the array identity is
 * stable for a run and can key the cache — the same arrangement as `filterArities`, and for the same
 * reason: the alternative is a linear scan of ~200 entries for every filter in every file.
 *
 * A filter whose type does not resolve gets NO ROW. `untyped` is what a missing row already means,
 * so storing it would say the same thing twice.
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
 * A parameter may name a set the implementation enumerates — `strftime` takes a string, a number of
 * seconds, a Date or a Time and raises on anything else, measured against a live instance — and the
 * published `types` array carries all four. A value is wrong there only when it matches NONE of them.
 *
 * ONE UNRECOGNISED BRANCH COLLAPSES THE WHOLE SET to `untyped`: the union names something this
 * repository cannot place, so "anything is accepted" is the only reading that cannot refuse working
 * code. That is also what `untyped` itself means, and why it is never one branch among several.
 *
 * {@link docsetParameterType} is this answer narrowed to a single type for a caller that has nowhere
 * to put a union — `tagParameterTypes`, whose map holds one type per parameter.
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
 * {@link filterReturnTypes}, keyed weakly on the array `tags()` memoizes.
 *
 * A parameter whose type does not resolve gets NO ROW, and a tag left with no typed parameter gets
 * no row either: `untyped` is what a missing row already means. How much that leaves is the
 * document's business and has swung once already — 5 of 72 parameters were typed while the
 * documentation site published a hardcoded `"untyped"`, and 69 of 72 the day that was fixed — so a
 * consumer is silent about exactly what the platform has not published. Silence is the only safe
 * reading: this repository is a CONSUMER of the docset, and a guessed type refuses working code.
 *
 * ROW ORDER MUST NOT DECIDE THE ANSWER, for the reason `filtersMap` states: `tags.json` ships two
 * entries named `else` and has no merge upstream, so a plain last-wins reduce would let whichever
 * row the docs site happens to list second erase the other's. Two rules keep the answer the same
 * whichever order the file arrives in:
 *
 * - A duplicate ADDS. A parameter one row types and the other leaves `untyped` keeps the type.
 * - A CONTRADICTION is not a fact. Two rows typing the same parameter differently leaves it with no
 *   row at all, which is what `untyped` already means — never one of the two, chosen by position.
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
 * PARAMETER 0 IS THE PIPED VALUE — upstream derives the list from the Ruby signature, where the
 * input is the first argument, and `arity` counts it as one. So `{{ 123 | hash_add_key: 'k', v }}`
 * is checked against `hash`, `key`, `value` in that order.
 *
 * Unlike {@link tagParameterTypes} this keeps `untyped` rows: a caller matching a WRITTEN argument to
 * a parameter needs the positions to line up, and dropping the untyped ones would shift every
 * parameter after them onto the wrong argument.
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
 * THE MARKER IS THE PRESENCE OF `untyped` ON ANY FILTER PARAMETER, and it is a marker rather than a
 * version number because it is the same fact: `untyped` exists so that a parameter accepting several
 * types can say so, and until the platform had that spelling every such parameter was published as
 * `object` — the same token `hash_add_key` uses for a Hash it raises without. The two senses cannot
 * be told apart, and reading either as a contract reported 1,279 offenses across four production
 * projects with not one real among them. 1,184 were `object` standing in for "anything".
 *
 * So a docset published before the separation makes NO argument-type claim this repository will act
 * on, and `ValidFilterArgumentTypes` stays silent on it. A docset from after it does, and the check
 * starts reporting with no change here — the same way `ValidTagArgumentTypes` waited for `tags.json`
 * to carry types. Measured after the separation: 123 of 417 filter parameters are `untyped`,
 * including every parameter of every core Liquid filter, because those coerce instead of refusing —
 * `{{ 5 | upcase }}`, `{{ '5' | minus: 1 }}` and `{{ 'abc' | where: 'x', 1 }}` all render, measured
 * against a live instance, while `{{ 123 | hash_add_key: 'k', v }}` raises.
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
 * NOT `isTypeCompatible`, and the whole difference is `object`. That one widens `object` to accept an
 * array and a range, which is right for a `{% doc %}` `@param {object}` — an author writing it means
 * "some structured value" — and wrong for a filter, where `object` is the Hash spelling and the
 * runtime says so. Measured against a live instance: `{{ [] | hash_add_key: 'hello', 'world' }}`,
 * `{{ [1,2] | hash_keys }}`, `{{ [1,2] | querify }}` and `{{ (1..3) | hash_add_key: 'a', 1 }}` each
 * raise `first argument must be a hash` and take the page with them, while `{% assign h = {} %}` piped
 * into the same call renders. A filter that genuinely takes either publishes BOTH — `to_xml` and
 * `www_form_encode` are `object, array` — so widening here would only hide the ones that do not.
 *
 * `boolean` still accepts every value, for the reason it does everywhere: every value in Liquid is
 * truthy or falsy, so nothing can contradict it.
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
 * A list of filter names must never be reintroduced beside this. The types come from the docset,
 * where they are derived from the Ruby annotations, and a hand-written table has no way to look
 * wrong — a name in the wrong bucket is a blocking refusal of working code, and a duplicate entry
 * is invisible by construction.
 */
export function filterChainType(
  filters: readonly { name: string }[],
  returnTypes: ReadonlyMap<string, LiquidType> | undefined,
): LiquidType {
  const last = filters[filters.length - 1];
  if (!last) return 'untyped';
  return returnTypes?.get(last.name) ?? 'untyped';
}
