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
  const types = parameter.types;
  if (!types || types.length === 0) return 'untyped';

  const mapped = new Set(types.map((name) => DOCSET_TYPES[name] ?? 'untyped'));
  const [only] = mapped;
  return mapped.size === 1 ? only : 'untyped';
}

/**
 * Argument types by tag name, built once per docset — the tag counterpart of
 * {@link filterReturnTypes}, keyed weakly on the array `tags()` memoizes.
 *
 * A parameter whose type does not resolve gets NO ROW, and a tag left with no typed parameter gets
 * no row either: `untyped` is what a missing row already means. On the shipped `tags.json` that
 * leaves exactly `for` and `tablerow` — 67 of the 72 published parameters are `untyped` — so a
 * consumer is silent about everything else until the platform publishes real types. Silence is the
 * only safe reading: this repository is a CONSUMER of the docset, and a guessed type refuses
 * working code.
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
