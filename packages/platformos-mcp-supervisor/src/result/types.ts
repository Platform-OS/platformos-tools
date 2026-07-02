/**
 * The `validate_code` result contract — the agent-facing surface of the
 * supervisor.
 *
 * This is intentionally separate from check-common's `Offense`: `Offense` is a
 * stable, minimal detection type consumed by editors/CLI/browser, whereas
 * `ValidateCodeResult` is an LLM-ergonomics surface that may churn as agent
 * behaviour is tuned. The `result/` layer assembles this shape from enriched
 * diagnostics + advisories via order-independent pure transforms.
 *
 * Field names mirror the v1 supervisor so the parity safety net (TASK-8.5) can
 * compare unchanged-contract fields against the captured baselines. Fields
 * marked "TASK-8" are part of the contract but are only populated once the
 * supervisor's per-domain layer and rule library are restored; the minimal
 * TASK-7 build leaves them empty / null.
 */

export type ValidateCodeMode = 'full' | 'quick';

export type ValidateCodeStatus = 'ok' | 'warning' | 'error';

export type ValidateCodeSeverity = 'error' | 'warning' | 'info';

/** Tool input. */
export interface ValidateCodeParams {
  /** Path of the file under edit (absolute, or relative to the project root). */
  file_path: string;
  /** The file contents to validate (the in-memory buffer). */
  content: string;
  /** Depth of analysis. Defaults to `full`. */
  mode?: ValidateCodeMode;
}

/**
 * An agent-facing fix. Translated from a check-common `FixDescription` (the
 * structured edits the engine already computed); the supervisor never
 * regenerates edit text from scratch.
 *
 * - `text_edit` — replace `[start_index, end_index)` with `new_text`.
 * - `insert`    — insert `new_text` at `start_index` (`end_index === start_index`).
 * - `guidance`  — prose only; no machine-applicable edit.
 */
export type AgentFix =
  | {
      type: 'text_edit' | 'insert';
      description?: string;
      /** 0-based offset into the file. */
      start_index: number;
      /** 0-based offset into the file. */
      end_index: number;
      new_text: string;
    }
  | {
      type: 'guidance';
      description: string;
    };

/**
 * A diagnostic as surfaced to the agent. Carries the structured check-common
 * fields (`check`, `severity`, range, `message`) plus the supervisor's
 * ergonomic enrichment (`hint`, `suggestion`, `confidence`, `fix`, `see_also`).
 * Line/column are 1-based (converted from check-common's 0-based offsets in the
 * `result/` layer).
 */
export interface ValidateCodeDiagnostic {
  /** The check code, e.g. `MissingPartial`, or a `pos-supervisor:` advisory code. */
  check: string;
  severity: ValidateCodeSeverity;
  message: string;
  /** 1-based line of the diagnostic start. */
  line: number;
  /** 1-based column of the diagnostic start. */
  column: number;
  /** 1-based line of the diagnostic end, when known. */
  end_line?: number;
  /** 1-based column of the diagnostic end, when known. */
  end_column?: number;
  /** Markdown explanation for the agent. */
  hint?: string;
  /** A short, one-line "did you mean / use this" pointer. */
  suggestion?: string;
  /** Static confidence in [0, 1] that this diagnostic + its fix are correct. */
  confidence?: number;
  /** A single concrete fix for this diagnostic, when one is available. */
  fix?: AgentFix;
  /** A pointer to another supervisor tool / doc that helps resolve this. */
  see_also?: SeeAlso;
}

export interface SeeAlso {
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
}

/**
 * A proposed fix shown to the agent at the top level of the result. Carries the
 * originating `check` so the agent can correlate it with a diagnostic.
 */
export type ProposedFix = AgentFix & { check?: string | null };

/** A group of related diagnostics sharing a root cause, with a unified remedy. */
export interface DiagnosticCluster {
  check: string;
  count: number;
  unified_fix?: string;
}

/** An advisory note about the file's architecture (doc-block coverage, layout correctness, …). */
export interface ScorecardNote {
  category: string;
  status: 'ok' | 'warning' | 'info';
  reason: string;
}

// ── TASK-8 fields (per-domain layer + result completion) ─────────────────────
// Declared here so the result shape is stable; populated by TASK-8.2 / TASK-8.4.

export interface TipEntry {
  id: string;
  severity: string;
  message: string;
}

export interface DomainGuideGotcha {
  id: string;
  message: string;
  severity: string;
  applies_to_errors?: string[];
}

export interface DomainGuide {
  domain: string;
  rule?: string;
  triggered_gotchas: DomainGuideGotcha[];
}

/**
 * Freshness/applicability of the blast-radius answer. Distinguishes a real
 * "nothing depends on this" (`computed`, total 0 — safe to change) from "we don't
 * know yet" (`computing`/`unavailable`) and from "this file type has no dependency
 * graph" (`not_applicable`), so an unbuilt/failed graph — or a file the graph
 * cannot model — can NEVER be misread as a green light.
 *
 * `not_applicable` is returned for files that are not graph-trackable edge targets
 * (e.g. schema / custom-model-type / translation YAML): nothing references them
 * via a resolvable edge — they are wired by model/table NAME, not by file
 * reference (see ADR 004) — so `total: 0` would falsely read as "safe to change".
 * See {@link ValidateCodeImpact}.
 */
export type ValidateCodeImpactStatus = 'computed' | 'computing' | 'unavailable' | 'not_applicable';

/**
 * Cross-file "blast radius" of editing the file: who DEPENDS ON it (its incoming
 * references), which lint cannot see (lint is per-file, forward-looking). Graph-
 * derived (`dependentsOf` over the cached project graph) and NEVER stale — a
 * changed project reports `computing`, never an out-of-date answer.
 *
 * `scope` is always `direct` (immediate callers only — transitive closure is
 * excluded as noise). `dependents` is meaningful ONLY when `status` is
 * `computed`; otherwise it is zeroed and the status says why.
 */
export interface ValidateCodeImpact {
  scope: 'direct';
  status: ValidateCodeImpactStatus;
  dependents: {
    /** Number of distinct files that reference the edited file. */
    total: number;
    /** Distinct referencing files per edge kind (render/include/function/…); a file using two kinds counts in both. */
    by_kind: Record<string, number>;
    /** Up to 10 distinct referencing files, project-relative, sorted. */
    sample: string[];
  };
  /**
   * Dependent callers whose arguments do NOT match the edited file's `{% doc %}`
   * signature — the cross-file counterpart to the `PartialCallArguments` lint
   * check (which only fires when editing the caller). Present ONLY when the
   * edited buffer declares a `{% doc %}` block (an explicit contract): an empty
   * array means "checked, every caller matches", absent means "no contract to
   * check against". Never inferred from a doc-less file (avoids false positives).
   */
  signature_risk?: ValidateCodeSignatureRisk[];
}

/** One dependent caller at risk from the edited file's current `{% doc %}` signature. */
export interface ValidateCodeSignatureRisk {
  /** The referencing file, project-relative. */
  caller: string;
  /** Required `@param`s the caller does not pass. */
  missing_required: string[];
  /** Arguments the caller passes that the `{% doc %}` block does not declare. */
  unexpected_args: string[];
}

/**
 * The full `validate_code` result. Serialized as a single JSON text block over
 * the MCP stdio transport.
 */
export interface ValidateCodeResult {
  status: ValidateCodeStatus;
  /**
   * When true the agent MUST NOT write the file. Set by any error or any
   * "blocking" warning (the blocking set is defined explicitly in `result/`).
   */
  must_fix_before_write: boolean;
  errors: ValidateCodeDiagnostic[];
  warnings: ValidateCodeDiagnostic[];
  infos: ValidateCodeDiagnostic[];
  proposed_fixes: ProposedFix[];
  clusters: DiagnosticCluster[];
  scorecard: ScorecardNote[];
  /**
   * Cross-file blast radius (graph-derived): who depends on the edited file.
   * Always present; `status` distinguishes a real "nothing depends on this"
   * from "not computed yet". See {@link ValidateCodeImpact}.
   */
  impact: ValidateCodeImpact;
  /** Deterministic prose telling the agent what to do next. */
  next_step?: string;
  /** Parse-failure message when the file could not be parsed at all; null/absent otherwise. */
  parse_error?: string | null;

  // TASK-8 fields (empty/null in the minimal TASK-7 build):
  tips?: TipEntry[];
  domain_guide?: DomainGuide | null;
}
