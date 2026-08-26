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

/** The cross-file comparison could not be run at all — a failure, or a deadline. */
export const UNAVAILABLE_IMPACT = (): ValidateCodeImpact => ({ status: 'unavailable' });

/**
 * The server was started with `--no-impact`, so nothing cross-file was attempted. Distinct
 * from `unavailable` on purpose: a retry cannot change this one.
 */
export const DISABLED_IMPACT = (): ValidateCodeImpact => ({ status: 'disabled' });

/** This file has no dependants the graph can find — see `ValidateCodeImpactStatus`. */
export const NOT_APPLICABLE_IMPACT = (): ValidateCodeImpact => ({ status: 'not_applicable' });
