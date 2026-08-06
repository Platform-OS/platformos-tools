/**
 * The non-`computed` blast-radius states.
 *
 * Each is a FACTORY, not a shared constant. The zeroed `dependents` object is
 * mutable and ends up inside a returned result; handing every caller the same
 * instance would let one mutation reach every past and future response. Factories
 * make that impossible for the cost of an allocation nobody will measure.
 *
 * They live here because the "zeroed dependents" shape was written out by hand in
 * four places across two tools and the assembler. That is the kind of duplication
 * that silently diverges — one copy gains a field, the others do not, and an agent
 * sees a different `impact` shape depending on which path answered.
 *
 * IMPORTANT: `dependents` is meaningful ONLY when `status` is `computed`. Every
 * state here zeroes it, and a zero here must NEVER be read as "nothing depends on
 * this, safe to change" — that is what `status` is for.
 */
import type { ValidateCodeImpact } from './types.js';

const noDependents = (): ValidateCodeImpact['dependents'] => ({
  total: 0,
  by_kind: {},
  sample: [],
});

/** The graph could not be consulted at all — a failure, or a deadline. */
export const UNAVAILABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'unavailable',
  dependents: noDependents(),
});

/** The graph is still being built or reconciled; ask again shortly. */
export const COMPUTING_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'computing',
  dependents: noDependents(),
});

/** This file has no dependency edges to speak of — see `ValidateCodeImpactStatus`. */
export const NOT_APPLICABLE_IMPACT = (): ValidateCodeImpact => ({
  scope: 'direct',
  status: 'not_applicable',
  dependents: noDependents(),
});
