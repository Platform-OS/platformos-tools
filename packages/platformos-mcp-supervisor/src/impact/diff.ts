/**
 * What a change INTRODUCED in a file it did not edit.
 *
 * PURE, and deliberately the whole definition of "relevant". The alternative — an allowlist
 * of check codes that count as cross-file — rots the first time a check is added, and it
 * asks the wrong question anyway: a `DeprecatedFrontmatterField` already in a dependant is
 * irrelevant because it was there BEFORE, not because of its code. Relevance is CAUSAL, so
 * it is computed by comparing the same file linted twice rather than by classifying codes.
 *
 * IDENTITY IS (check, line, column). The dependant's own text is byte-identical across the
 * two passes — only the files it depends on changed — so positions are stable and cannot
 * drift under the comparison. Matching on the code alone would let a pre-existing
 * `UnknownFilter` on line 90 mask a new one on line 3.
 *
 * A MULTISET, not a set: two offenses can legitimately share a code and a position is the
 * only thing that separates them, so the count at each identity is what carries over. Three
 * `before` and four `after` at one identity means one new, not none.
 */
import type { ValidateCodeDiagnostic } from '../result/types.js';

/** The comparison key: what makes two findings the same finding. */
function identityOf(diagnostic: ValidateCodeDiagnostic): string {
  return `${diagnostic.check}\u0000${diagnostic.line}\u0000${diagnostic.column}`;
}

/**
 * The diagnostics in `after` that are not in `before`, preserving `after`'s order.
 *
 * `before` is the file as it stands with NONE of the changeset overlaid; `after` is the same
 * file with the changeset applied. Everything returned is therefore attributable to the
 * change.
 */
export function introducedDiagnostics(
  after: readonly ValidateCodeDiagnostic[],
  before: readonly ValidateCodeDiagnostic[],
): ValidateCodeDiagnostic[] {
  if (after.length === 0) return [];

  const remaining = new Map<string, number>();
  for (const diagnostic of before) {
    const key = identityOf(diagnostic);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const introduced: ValidateCodeDiagnostic[] = [];
  for (const diagnostic of after) {
    const key = identityOf(diagnostic);
    const unmatched = remaining.get(key) ?? 0;
    // Each `before` occurrence cancels exactly one `after` occurrence, so a code that
    // legitimately fires twice does not swallow a third.
    if (unmatched > 0) remaining.set(key, unmatched - 1);
    else introduced.push(diagnostic);
  }

  return introduced;
}
