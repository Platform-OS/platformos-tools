/**
 * Result assembly.
 *
 * Buckets the mapped diagnostics into errors / warnings / infos and derives the `status` +
 * `must_fix_before_write` envelope. PURE — no I/O, consumes only the diagnostic list and
 * the shared result types. `impact` is pre-computed by the impact adapter and included
 * verbatim.
 *
 * The result carries ONLY fields that are actually populated: an agent cannot tell an
 * always-empty field from a meaningful one.
 */
import { blocksWrite } from './blocking.js';
import { NOT_APPLICABLE_IMPACT } from './impact-states.js';
import type {
  Declined,
  ValidateCodeDiagnostic,
  ValidateCodeImpact,
  ValidateCodeResult,
  ValidateCodeStatus,
} from './types.js';

/**
 * Order diagnostics the way someone READS the file: top to bottom, left to right.
 *
 * `check()` collects results per check, so the raw order is grouped by check code — an
 * `ImgWidthAndHeight` on line 5 arrives before a `MissingPartial` on line 1.
 *
 * Sorting belongs HERE rather than in check-common: the engine's job is detection, and
 * per-check batching is what makes it fast. `check` is the final tiebreak so two findings
 * at the identical position have a deterministic order across runs.
 */
function inReadingOrder(diagnostics: ValidateCodeDiagnostic[]): ValidateCodeDiagnostic[] {
  return [...diagnostics].sort(
    (a, b) => a.line - b.line || a.column - b.column || a.check.localeCompare(b.check),
  );
}

export function assembleResult(
  diagnostics: ValidateCodeDiagnostic[],
  impact: ValidateCodeImpact,
): ValidateCodeResult {
  const ordered = inReadingOrder(diagnostics);
  const errors = ordered.filter((d) => d.severity === 'error');
  const warnings = ordered.filter((d) => d.severity === 'warning');
  const infos = ordered.filter((d) => d.severity === 'info');

  // `ok` MEANS "checked, nothing objected" — honest only while every file type this server
  // admits has at least one check that examines it. That is an INVARIANT, not a fact, and
  // `transport/validate-code.spec.ts`'s file-type-coverage group fails if a type is ever
  // admitted with nothing looking at it. Read it before adding a `PlatformOSFileType`.
  const status: ValidateCodeStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

  return {
    status,
    // NOT `errors.length > 0`. `status` says what was FOUND; this says whether the file is
    // broken, which is a strictly smaller question — see `blocking.ts`.
    must_fix_before_write: blocksWrite(errors),
    errors,
    warnings,
    infos,
    impact,
  };
}

/**
 * The result for a file this server did NOT check — outside the project root, not a
 * platformOS source type, too large to parse safely, or past its deadline (see
 * `fileApplicability` / `bufferTooLarge` / `withDeadline`).
 *
 * Everything is empty and `must_fix_before_write` is `false`, so the call neither blocks
 * the write nor approves it — including for a TIMEOUT, since blocking a write because our
 * own validation failed would make the tool a liability. `reason` lands in `next_step`;
 * `code` lands in `not_applicable_reason` for an agent to branch on.
 *
 * `impact` is `not_applicable`: nothing cross-file was compared either.
 */
export function assembleNotApplicableResult(declined: Declined): ValidateCodeResult {
  return {
    status: 'not_applicable',
    not_applicable_reason: declined.code,
    must_fix_before_write: false,
    errors: [],
    warnings: [],
    infos: [],
    impact: NOT_APPLICABLE_IMPACT(),
    next_step: declined.reason,
  };
}
