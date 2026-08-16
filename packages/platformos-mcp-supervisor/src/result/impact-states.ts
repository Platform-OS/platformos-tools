/**
 * The non-`computed` blast-radius states.
 *
 * Each is a FACTORY, not a shared constant: the zeroed `dependents` object is mutable and
 * ends up inside a returned result, so one shared instance would let a mutation reach every
 * past and future response.
 *
 * IMPORTANT: `dependents` is meaningful ONLY when `status` is `computed`. Every state here
 * zeroes it, and a zero must NEVER be read as "nothing depends on this, safe to change" —
 * that is what `status` is for.
 */
import type { ValidateCodeImpact } from './types.js';

const noDependents = (): ValidateCodeImpact['dependents'] => ({
  total: 0,
  by_kind: {},
  sample: [],
});

/** The blast radius could not be computed at all — a failure, or a deadline. */
export const UNAVAILABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'unavailable',
  dependents: noDependents(),
});

/** This file has no dependency edges to speak of — see `ValidateCodeImpactStatus`. */
export const NOT_APPLICABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'not_applicable',
  dependents: noDependents(),
});
