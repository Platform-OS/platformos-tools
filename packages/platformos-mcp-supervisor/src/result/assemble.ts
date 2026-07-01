/**
 * Result assembly (minimal "lint only" slice).
 *
 * Buckets the mapped diagnostics into errors / warnings / infos and derives the
 * `status` + `must_fix_before_write` envelope. PURE — no I/O, consumes only the
 * diagnostic list and the shared result types.
 *
 * `dependencies` and `structural` are graph-derived facts pre-computed by the
 * structure adapter and included verbatim. The remaining ergonomic transforms
 * (clustering, scorecard, the explicit blocking-warning set, `next_step`, tips,
 * domain_guide) are added in later tasks; they are left empty/null here.
 */
import type {
  ValidateCodeDependency,
  ValidateCodeDiagnostic,
  ValidateCodeMode,
  ValidateCodeResult,
  ValidateCodeStatus,
  ValidateCodeStructuralSnapshot,
} from './types';

export function assembleResult(
  diagnostics: ValidateCodeDiagnostic[],
  // The file's resolved outgoing dependencies (graph-derived, pre-computed by
  // the structure adapter). Included verbatim — assembly stays pure.
  dependencies: ValidateCodeDependency[],
  // The file's own structural declarations (graph-derived), or null when the
  // buffer is non-Liquid / unparseable. Included verbatim.
  structural: ValidateCodeStructuralSnapshot | null,
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
    dependencies,
    parse_error: null,
    tips: [],
    domain_guide: null,
    structural,
  };
}
