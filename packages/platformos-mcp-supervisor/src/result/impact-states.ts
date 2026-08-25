/**
 * The non-`computed` impact states.
 *
 * Each is a FACTORY, not a shared constant: the object ends up inside a returned result, so
 * one shared instance would let a mutation reach every past and future response.
 *
 * NEITHER IS A CLEARANCE, and neither is `computed` — impact publishes findings only, so
 * nothing here or anywhere else says "nothing depends on this". See `ValidateCodeImpact`.
 */
import type { ValidateCodeImpact } from './types.js';

/** The comparison could not be run at all — a failure, or a deadline. */
export const UNAVAILABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'unavailable',
});

/** There was no `{% doc %}` contract to compare callers against — see `ValidateCodeImpactStatus`. */
export const NOT_APPLICABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'not_applicable',
});
