/**
 * Result assembly (minimal "lint only" slice).
 *
 * Buckets the mapped diagnostics into errors / warnings / infos and derives the
 * `status` + `must_fix_before_write` envelope. PURE — no I/O, consumes only the
 * diagnostic list and the shared result types.
 *
 * The ergonomic transforms (clustering, scorecard, the explicit
 * blocking-warning set, `next_step`, tips, domain_guide, structural) are added
 * in later tasks; they are left empty/null here.
 */
import type {
  ValidateCodeDiagnostic,
  ValidateCodeMode,
  ValidateCodeResult,
  ValidateCodeStatus,
} from './types.js';

export function assembleResult(
  diagnostics: ValidateCodeDiagnostic[],
  // Reserved: `full`/`quick` do not yet change output (no heavier stages exist).
  _mode: ValidateCodeMode,
): ValidateCodeResult {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const infos = diagnostics.filter((d) => d.severity === 'info');

  const status: ValidateCodeStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

  return {
    status,
    // Minimal gate: any error blocks the write. The richer blocking-warning set
    // is defined in the result-assembly task.
    must_fix_before_write: errors.length > 0,
    errors,
    warnings,
    infos,
    proposed_fixes: [],
    clusters: [],
    scorecard: [],
    parse_error: null,
    tips: [],
    domain_guide: null,
    structural: null,
  };
}
