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

/**
 * The outcome of a `validate_code` call.
 *
 * `ok` / `warning` / `error` all mean "this file was checked" and differ only in
 * what was found. `not_applicable` means the opposite — the file was NOT checked,
 * because it is outside the project root or is not a platformOS source type (see
 * `fileApplicability`). It is deliberately distinct from `ok`: reporting an
 * unchecked file as `ok` reads as "validated, safe to write", which is exactly
 * the false approval this status exists to prevent. `must_fix_before_write` is
 * always `false` for it — declining to judge must not block a legitimate write
 * either — and `next_step` carries the reason.
 */
export type ValidateCodeStatus = 'ok' | 'warning' | 'error' | 'not_applicable';

/**
 * WHY a file was not checked, as a machine-readable code.
 *
 * `next_step` explains the same thing in prose, but this is an agent surface and
 * prose is not a contract — an agent must be able to branch on the cause without
 * parsing English. Present exactly when `status` is `not_applicable`.
 *
 * - `outside_project`  — resolved outside the project root this server serves.
 * - `unsupported_type` — inside the project, but nothing here parses it: an asset, or a
 *                        file in no deployed subtree that is not a source anyway. ROUTINE
 *                        — a project holds plenty of files that are not platformOS sources
 *                        and are not meant to be, so this must never be advised "move it
 *                        under app/".
 * - `misplaced_source`  — a platformOS SOURCE (something this toolchain parses) sitting
 *                        outside every subtree the platform deploys. Almost always a
 *                        mistake, and the opposite advice from `unsupported_type`: the
 *                        platform will never load it, so a partial, page or query here is
 *                        dead code. Kept separate BECAUSE the remedies differ — check-node
 *                        splits these two at the point where classification happens
 *                        (`LintBufferStatus`), and collapsing them here would throw away a
 *                        distinction already paid for and leave the agent to re-derive it
 *                        from a raw path.
 * - `too_large`        — buffer above the size bound; refused before parsing.
 * - `timed_out`        — validation exceeded its deadline; nothing conclusive.
 * - `ignored`          — excluded by the project's `.platformos-check.yml` `ignore`
 *                        list, so no check ran. Reported rather than passed off as
 *                        `ok`: `check()` skips ignored files silently, and an
 *                        unparseable ignored file would otherwise come back clean.
 * - `internal_error`   — the validator failed to produce a result. A bug here, not
 *                        a property of the file. Distinct from `timed_out` so an
 *                        agent does not "retry with fewer files" for something
 *                        retrying cannot fix.
 *
 * All of them share the invariant that makes `not_applicable` safe: the file was NOT
 * checked, so the result is neither an approval nor a reason to block the write.
 */
export type NotApplicableReason =
  | 'outside_project'
  | 'unsupported_type'
  | 'misplaced_source'
  | 'too_large'
  | 'timed_out'
  | 'ignored'
  | 'internal_error';

/**
 * A refusal to validate: agent-facing prose plus its machine-readable cause.
 *
 * `reason` becomes the result's `next_step` so a declined call explains itself
 * rather than looking like a silent pass; `code` becomes `not_applicable_reason`,
 * which is what an agent branches on.
 */
export interface Declined {
  reason: string;
  code: NotApplicableReason;
}

export type ValidateCodeSeverity = 'error' | 'warning' | 'info';

/**
 * Tool input. Exactly ONE of the two forms:
 *
 *   - `file_path` + `content` — a single file (the original contract, unchanged).
 *   - `files` — several files validated TOGETHER, so they can reference each other.
 *
 * Both are optional here because the "exactly one" rule is enforced by the handler;
 * a zod union would emit `anyOf`, which several MCP clients do not surface.
 */
export interface ValidateCodeParams {
  /** Path of the single file under edit (absolute, or relative to the project root). */
  file_path?: string;
  /** The single file's contents (the in-memory buffer). */
  content?: string;
  /** Several files under edit, validated together. */
  files?: Array<{ file_path: string; content: string }>;
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

/** How many entries of one bucket were returned, against how many were found. */
export interface ValidateCodeBucketTruncation {
  /** Entries present in this result's list. */
  returned: number;
  /** Entries the checks actually produced. Always greater than `returned`. */
  total: number;
}

/**
 * Present exactly when findings were withheld to keep the response bounded.
 *
 * ABSENT means nothing was withheld — the lists are complete. That is why this is
 * optional rather than always emitted with zeroes: an agent cannot distinguish an
 * always-present field from a meaningful one, and the same reasoning already removed
 * the permanently-empty stubs elsewhere in this contract.
 *
 * Only the affected buckets appear. `note` states the same thing in prose, so an
 * agent that reads nothing but this JSON still learns that the list is partial —
 * silent truncation would be a false-completeness bug of exactly the kind this
 * package spends the most effort avoiding, and strictly worse than a large payload.
 */
export interface ValidateCodeTruncation {
  errors?: ValidateCodeBucketTruncation;
  warnings?: ValidateCodeBucketTruncation;
  infos?: ValidateCodeBucketTruncation;
  /** Plain-language statement of what was withheld and what is still true. */
  note: string;
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
  /**
   * Cross-file blast radius (graph-derived): who depends on the edited file.
   * Always present; `status` distinguishes a real "nothing depends on this"
   * from "not computed yet". See {@link ValidateCodeImpact}.
   */
  impact: ValidateCodeImpact;
  /** Deterministic prose telling the agent what to do next. */
  next_step?: string;
  /**
   * Machine-readable cause when `status` is `not_applicable`; absent otherwise.
   * See {@link NotApplicableReason}.
   */
  not_applicable_reason?: NotApplicableReason;
  /**
   * Present only when the response bound withheld findings. See
   * {@link ValidateCodeTruncation}.
   *
   * `status` and `must_fix_before_write` above are computed from the COMPLETE set of
   * findings, before anything is withheld, so neither is softened by truncation.
   */
  truncated?: ValidateCodeTruncation;
}

/** One file's outcome inside a multi-file {@link ValidateFilesResult}. */
export interface ValidateFilesEntry {
  /** The `file_path` exactly as the caller supplied it, so results are easy to match up. */
  file_path: string;
  result: ValidateCodeResult;
}

/**
 * The multi-file result: one entry per requested file plus a request-level gate.
 * Returned only for the `files` input form; the single form returns a bare
 * {@link ValidateCodeResult}.
 *
 * A batch is NOT atomic. One declined or failing file never sinks the others, so
 * `files` always has an entry for every requested path and the agent reads
 * per-file detail there.
 */
export interface ValidateFilesResult {
  /**
   * True when ANY file blocks. One gate to read: an agent about to write a
   * multi-file change needs a single answer to "may I write this changeset?", and a
   * coordinated edit is only as safe as its worst file.
   *
   * Note this is deliberately an OR over the files' own gates, so a file that is
   * merely `not_applicable` (not checked) never blocks the set.
   */
  must_fix_before_write: boolean;
  /** Per-file results, in the order requested. */
  files: ValidateFilesEntry[];
  /** Deterministic prose telling the agent what to do next across the whole batch. */
  next_step?: string;
}
