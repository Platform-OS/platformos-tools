/**
 * Named constants — single source of truth for magic numbers used across modules.
 *
 * Only includes values that affect tool behaviour (timeouts, thresholds,
 * confidence priors). Presentation limits (slice sizes for previews) stay local
 * to their call sites.
 *
 * Dropped relative to pos-supervisor 0.8.x because their sole consumers are
 * out of v1 scope: CHECK_TIMEOUT_MS / CHECK_MAX_BUFFER (pos-cli check
 * subprocess), HTTP_MAX_BODY (HTTP transport), CONSECUTIVE_ERROR_THRESHOLD
 * (session loop detection).
 */

// ── Timeouts ────────────────────────────────────────────────────────────────

/** How long to wait for LSP to be ready (initialization + warm-up). */
export const LSP_READY_TIMEOUT_MS = 30_000;

/** How long to wait for per-document LSP diagnostics. */
export const LSP_DIAGNOSTICS_TIMEOUT_MS = 5_000;

/** Cap on the barrier wait within awaitDiagnostics. */
export const LSP_BARRIER_TIMEOUT_MS = 3_000;

/** Time to wait for diagnostics to settle before resolving. */
export const DIAGNOSTICS_SETTLE_MS = 500;

/** TTL for the project_map cache before a fresh scan is triggered. */
export const PROJECT_MAP_CACHE_TTL_MS = 30_000;

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Max character distance for fuzzy position matching in AST lookups. */
export const POSITION_FUZZY_TOLERANCE = 3;

/** Max Levenshtein distance for "did you mean?" filter suggestions. */
export const FILTER_MATCH_MAX_DISTANCE = 2;

// ── Confidence defaults ─────────────────────────────────────────────────────

/** Diagnostic severities recognised by the pipeline. */
export type Severity = 'error' | 'warning' | 'info';

/**
 * Default confidence for a diagnostic when the rule engine did not set one.
 *
 * Errors are high-confidence (the linter is usually right about real bugs),
 * warnings are mid-confidence (more stylistic / context dependent), infos are
 * low-confidence (advisory). A populated confidence — even a default — lets
 * downstream consumers bucket every diagnostic instead of silently dropping
 * ones where no rule matched.
 */
export const DEFAULT_CONFIDENCE_BY_SEVERITY: Readonly<Record<Severity, number>> = {
  error: 0.9,
  warning: 0.7,
  info: 0.5,
};

/**
 * Default confidence for pos-supervisor structural warnings (check names
 * prefixed with `pos-supervisor:`). These are AST-derived, not LSP-derived,
 * and are more deterministic than severity alone suggests — they only fire
 * when the structural rule is actually hit.
 */
export const STRUCTURAL_DEFAULT_CONFIDENCE = 0.75;
