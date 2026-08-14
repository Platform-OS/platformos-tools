import { FilterEntry } from './types';

/** A published arity, validated. `null` max means variadic — it can refuse nothing. */
export type ResolvedArity = { min: number; max: number | null };

/**
 * Arity by filter name, built once per docset rather than per file.
 *
 * `platformosDocset.filters()` is memoized by `AugmentedPlatformOSDocset`, so the array identity is
 * stable for a run and can key the cache. The alternative — a linear scan of ~200 entries for every
 * filter in every file — is what `UnknownFilter` does, and these checks run on the same nodes.
 */
const ARITY_BY_DOCSET = new WeakMap<readonly FilterEntry[], ReadonlyMap<string, ResolvedArity>>();

export function filterArities(filters: readonly FilterEntry[]): ReadonlyMap<string, ResolvedArity> {
  const cached = ARITY_BY_DOCSET.get(filters);
  if (cached) return cached;

  const arities = new Map<string, ResolvedArity>();
  for (const filter of filters) {
    // An incomplete row is no row at all: a filter with no usable arity goes unchecked, and
    // `max: null` — "variadic, cannot refuse an argument" — is a claim only a complete row may make.
    // The docs template publishes `{min: null, max: null}` for a signature it could not read.
    //
    // This is the only validation of the published field.
    if (!filter.arity) continue;
    const { min, max } = filter.arity;
    if (typeof min !== 'number') continue;
    if (max !== null && typeof max !== 'number') continue;
    arities.set(filter.name, { min, max });
  }

  ARITY_BY_DOCSET.set(filters, arities);
  return arities;
}

/**
 * What the platform says this filter accepts, or `undefined` when it says nothing.
 *
 * The docset is the only source: `arity` is derived upstream from the Ruby signature. `undefined`
 * means unchecked, which is the only safe answer for a blocking check — guessing a range would
 * refuse working code.
 *
 * One resolution shared by every consumer, so no caller can invent its own precedence.
 */
export function resolveArity(
  name: string,
  arities: ReadonlyMap<string, ResolvedArity>,
): ResolvedArity | undefined {
  return arities.get(name);
}

/** Whether a call with `given` arguments — the piped value included — is within the range. */
export function acceptsArgumentCount(arity: ResolvedArity, given: number): boolean {
  return given >= arity.min && (arity.max === null || given <= arity.max);
}
