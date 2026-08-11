/**
 * Result assembly (minimal "lint only" slice).
 *
 * Buckets the mapped diagnostics into errors / warnings / infos and derives the
 * `status` + `must_fix_before_write` envelope. PURE — no I/O, consumes only the
 * diagnostic list and the shared result types.
 *
 * `impact` is the graph-derived cross-file blast radius (who depends on the
 * file), pre-computed by the impact adapter and included verbatim.
 *
 * The result carries ONLY fields that are actually populated. The ergonomic
 * additions (proposed fixes, clustering, scorecard, tips, domain guide,
 * `parse_error`) were previously emitted as permanently-empty stubs; an agent
 * cannot tell an always-`[]` field from a meaningful one, so they were removed and
 * will be reintroduced by the tasks that actually fill them (TASK-8.x).
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
 * `check()` runs one pipeline per check and collects results per check, so the raw
 * order is grouped by check code — an `ImgWidthAndHeight` on line 5 arrives before a
 * `MissingPartial` on line 1. That is fine for a linter dumping a report, but an
 * agent walking the list to fix a file jumps around it, and a human reading the JSON
 * cannot tell whether the list is ordered at all.
 *
 * Sorting belongs HERE rather than in check-common: the engine's job is detection,
 * and per-check batching is exactly what makes it fast (TASK-12). Presentation order
 * is an agent-ergonomics concern, which is this package's whole remit.
 *
 * `check` is the final tiebreak so that two findings at the identical position have
 * a deterministic order — without it, byte-identical inputs could produce results
 * that differ between runs, which would make offense-comparison verification (used
 * throughout TASK-12) unreliable.
 */
function inReadingOrder(diagnostics: ValidateCodeDiagnostic[]): ValidateCodeDiagnostic[] {
  return [...diagnostics].sort(
    (a, b) => a.line - b.line || a.column - b.column || a.check.localeCompare(b.check),
  );
}

export function assembleResult(
  diagnostics: ValidateCodeDiagnostic[],
  // The file's cross-file blast radius (graph-derived, pre-computed by the impact
  // adapter). Included verbatim — assembly stays pure.
  impact: ValidateCodeImpact,
): ValidateCodeResult {
  const ordered = inReadingOrder(diagnostics);
  const errors = ordered.filter((d) => d.severity === 'error');
  const warnings = ordered.filter((d) => d.severity === 'warning');
  const infos = ordered.filter((d) => d.severity === 'info');

  // `ok` MEANS "checked, nothing objected" — and that claim is only honest while
  // every file type this server admits has at least one check that examines it.
  //
  // It has not always been. An evaluation found three YAML file-type families
  // (model/custom model types, transactable types, instance profile types) where the
  // lint ran and ZERO checks applied: the only two YAML checks were translation
  // content checks that return immediately on any other path. The answer was `ok`,
  // which the instructions define as "the file WAS checked" — so an agent was told a
  // file had been examined when nothing had looked at it, for a class whose
  // uncovered failure mode fails the entire deploy.
  //
  // The fix belonged upstream, not here. `YAMLSyntaxError` (TASK-21) gave those
  // families a check, and re-measuring afterwards found ZERO admitted file types with
  // nothing examining them — all 14, across 17 directory spellings. So `ok` is
  // accurate and needs no new vocabulary; introducing a `no_applicable_checks` state
  // would have spent the "we did not look" signal on precisely the class we had just
  // started looking at.
  //
  // That makes this an INVARIANT rather than a fact, and it is guarded as one:
  // `transport/validate-code.spec.ts`'s file-type-coverage group fails if a file type is
  // ever admitted without something to examine it. Read it before adding a
  // `PlatformOSFileType`.
  const status: ValidateCodeStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

  return {
    status,
    // NOT `errors.length > 0`. `status` says what was FOUND; this says whether the
    // file is broken, which is a strictly smaller question — see `blocking.ts`.
    // A dead argument is a real `error` in the list below and still leaves this
    // false, because writing the file works fine.
    must_fix_before_write: blocksWrite(errors),
    errors,
    warnings,
    infos,
    impact,
  };
}

/**
 * The result for a file this server did NOT check — outside the project root, not
 * a platformOS source type, too large to parse safely, or past its deadline (see
 * `fileApplicability` / `bufferTooLarge` / `withDeadline` for why each case is
 * refused).
 *
 * Everything is empty and `must_fix_before_write` is `false`, so the call neither
 * blocks the write nor approves it. `reason` lands in `next_step` for a human or
 * an LLM to read; `code` lands in `not_applicable_reason` for an agent to branch
 * on without parsing prose.
 *
 * `must_fix_before_write: false` even for a TIMEOUT is deliberate: blocking a
 * write because our own validation failed would make the tool a liability rather
 * than a safeguard, and it matches how `impact` already degrades. The agent is
 * told plainly that nothing was checked.
 *
 * `impact` is `not_applicable` for the same underlying reason the lint is, and its
 * zeroed `dependents` must never be read as "nothing depends on this".
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
