/**
 * The `validate_code` result contract — the agent-facing surface of the supervisor.
 *
 * Deliberately separate from check-common's `Offense`, which is the stable, minimal
 * detection type consumed by editors/CLI/browser. The `result/` layer assembles this
 * shape from enriched diagnostics via order-independent pure transforms.
 */

/**
 * The outcome of a `validate_code` call.
 *
 * `ok` / `warning` / `error` all mean "this file was checked" and differ only in what was
 * found. `not_applicable` means the file was NOT checked (see `fileApplicability`), so it
 * is neither an approval nor a reason to block: `must_fix_before_write` is always `false`
 * for it and `next_step` carries the reason.
 */
export type ValidateCodeStatus = 'ok' | 'warning' | 'error' | 'not_applicable';

/**
 * WHY a file was not checked, as a machine-readable code an agent can branch on.
 * Present exactly when `status` is `not_applicable`.
 *
 * - `outside_project`  — resolved outside the project root this server serves.
 * - `unsupported_type` — inside the project, but nothing here parses it: an asset, or a
 *                        file in no deployed subtree that is not a source anyway. ROUTINE —
 *                        never advise moving it under `app/`.
 * - `misplaced_source` — a platformOS SOURCE sitting outside every subtree the platform
 *                        deploys, so it will never be loaded. Almost always a mistake, and
 *                        the opposite advice from `unsupported_type`.
 * - `too_large`        — buffer above the size bound; refused before parsing.
 * - `timed_out`        — validation exceeded its deadline; nothing conclusive.
 * - `ignored`          — excluded by the project's `.platformos-check.yml` `ignore` list,
 *                        so no check ran.
 * - `internal_error`   — the validator failed to produce a result. A bug here, not a
 *                        property of the file, and not something a retry can fix.
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
 * `reason` becomes the result's `next_step`; `code` becomes `not_applicable_reason`.
 */
export interface Declined {
  reason: string;
  code: NotApplicableReason;
}

export type ValidateCodeSeverity = 'error' | 'warning' | 'info';

/**
 * Tool input. Exactly ONE of the two forms:
 *
 *   - `file_path` + `content` — a single file.
 *   - `files` — several files validated TOGETHER, so they can reference each other.
 *
 * Both are optional here because the "exactly one" rule is enforced by the handler; a zod
 * union would emit `anyOf`, which several MCP clients do not surface.
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
 * One replacement in the buffer, translated verbatim from a check-common
 * `FixDescription`. The supervisor never authors edit text.
 *
 * Offsets are 0-based indices into the buffer AS SENT — not the 1-based line/column the
 * diagnostic carries.
 */
export interface AgentEdit {
  /** 0-based offset into the buffer, INCLUSIVE. */
  start_index: number;
  /** 0-based offset into the buffer, EXCLUSIVE. Equal to `start_index` for an insertion. */
  end_index: number;
  /** Replacement text for the range. Empty string to delete. */
  new_text: string;
}

/**
 * An agent-facing fix: prose plus the edits that apply it.
 *
 * Every edit is relative to the buffer as sent, so applying more than one requires
 * accounting for index drift — or simply applying them from the end backwards.
 */
export interface AgentFix {
  /**
   * What the fix does. Present for a suggestion (the engine's own `Suggestion.message`);
   * absent for a plain autofix, which the engine describes only through the message.
   */
  description?: string;
  /** The edits, in the order the engine recorded them. Never empty. */
  edits: AgentEdit[];
}

/**
 * A diagnostic as surfaced to the agent: the structured check-common fields (`check`,
 * `severity`, range, `message`) plus the supervisor's ergonomic enrichment (`hint`,
 * `suggestions`, `fix`, `see_also`).
 *
 * Line/column are 1-based (converted from check-common's 0-based offsets in `result/`).
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
  /**
   * Fixes the engine offers as OPTIONS rather than as the answer — `Offense.suggest`.
   *
   * Kept separate from {@link fix} because an agent must act on them differently: `fix` is
   * safe to apply unread, a suggestion is a choice. Absent when the engine offered none.
   */
  suggestions?: AgentFix[];
  /**
   * The engine's safe auto-fix for this diagnostic, when it has one — `Offense.fix`.
   * Distinct from {@link suggestions}: this one is the answer, not a menu.
   */
  fix?: AgentFix;
  /**
   * URL of this check's documentation page, from check-common `meta.docs.url`. Absent for
   * checks whose meta publishes none, rather than a guessed URL that 404s.
   */
  see_also?: string;
}

/**
 * Whether the cross-file comparison ran. `computed` means this file's dependants were linted
 * with the change applied and without it; `unavailable` means that could not be done (a
 * failure, or the deadline); `not_applicable` means the file has no dependants this stage
 * can find — the graph holds no edges pointing at it, or it has no logical name.
 *
 * `disabled` means this SERVER was started with cross-file impact turned off (`--no-impact`),
 * so nothing was attempted and retrying will not change that — which is the whole reason it
 * is not folded into `unavailable`.
 *
 * NONE OF THE FOUR IS A CLEARANCE, including `computed`. See {@link ValidateCodeImpact}.
 */
export type ValidateCodeImpactStatus = 'computed' | 'unavailable' | 'not_applicable' | 'disabled';

/**
 * What this change BREAKS in files the request is not editing — the question lint cannot
 * answer, being per-file and forward-looking. Derived per request by linting the edited
 * file's dependants twice, with the changeset applied and without it, and reporting only the
 * difference. The findings are the check engine's own, so they carry its message, severity
 * and documentation link rather than a second opinion invented here.
 *
 * IT DOES NOT ANSWER "WHO DEPENDS ON THIS FILE", and never will: `{% render var %}` names its
 * target at runtime, so no static analysis can enumerate a file's dependants, and a count
 * that omits the ones it cannot see reads as a licence to delete. Only findings are
 * published; their absence claims nothing.
 */
export interface ValidateCodeImpact {
  status: ValidateCodeImpactStatus;
  /**
   * Files the change broke, each with the findings it GAINED. A finding already present
   * before the change is not reported, however severe: it is not this edit's doing.
   *
   * PRESENT ONLY WHEN NON-EMPTY, and absence is not a clearance — it means no break was
   * found among the dependants that are visible, which is not the same as none existing.
   */
  breaks?: ValidateCodeImpactBreak[];
  /**
   * Present only when more dependants were found than the bound allows: `returned` were
   * linted, `total` were found.
   *
   * NOT the same kind of truncation as the result-level `truncated`, which withholds
   * findings that WERE computed. The difference here was never checked at all, so an
   * otherwise-clean answer carrying this field is a PARTIAL one.
   */
  unchecked_dependants?: ValidateCodeBucketTruncation;
}

/** One file the change broke, and what it broke in it. */
export interface ValidateCodeImpactBreak {
  /** The broken file, project-relative. NOT a file the request asked about. */
  file: string;
  /** The findings this change introduced there, in reading order. */
  diagnostics: ValidateCodeDiagnostic[];
}

/** How many entries of one bucket were returned, against how many were found. */
export interface ValidateCodeBucketTruncation {
  /** Entries present in this result's list. */
  returned: number;
  /** Entries the checks actually produced. Always greater than `returned`. */
  total: number;
}

/**
 * Present exactly when findings were withheld to keep the response bounded; ABSENT means
 * the lists are complete. Only the affected buckets appear.
 */
export interface ValidateCodeTruncation {
  errors?: ValidateCodeBucketTruncation;
  warnings?: ValidateCodeBucketTruncation;
  infos?: ValidateCodeBucketTruncation;
  /** Plain-language statement of what was withheld and what is still true. */
  note: string;
}

/**
 * The full `validate_code` result. Serialized as a single JSON text block over the MCP
 * stdio transport.
 */
export interface ValidateCodeResult {
  status: ValidateCodeStatus;
  /**
   * When true the agent MUST NOT write the file. Set by any error or any "blocking"
   * warning (the blocking set is defined explicitly in `result/`).
   */
  must_fix_before_write: boolean;
  errors: ValidateCodeDiagnostic[];
  warnings: ValidateCodeDiagnostic[];
  infos: ValidateCodeDiagnostic[];
  /**
   * Cross-file consequence of the edit: what it breaks in files you are not editing.
   * Always present, and never a clearance. See {@link ValidateCodeImpact}.
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
   * Present only when the response bound withheld findings. `status` and
   * `must_fix_before_write` are computed from the COMPLETE set of findings, before
   * anything is withheld. See {@link ValidateCodeTruncation}.
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
 * The multi-file result: one entry per requested file plus a request-level gate. Returned
 * only for the `files` input form; the single form returns a bare
 * {@link ValidateCodeResult}.
 *
 * A batch is NOT atomic. One declined or failing file never sinks the others, so `files`
 * always has an entry for every requested path.
 */
export interface ValidateFilesResult {
  /**
   * True when ANY file blocks — an OR over the files' own gates, so a file that is merely
   * `not_applicable` never blocks the set.
   */
  must_fix_before_write: boolean;
  /** Per-file results, in the order requested. */
  files: ValidateFilesEntry[];
  /** Deterministic prose telling the agent what to do next across the whole batch. */
  next_step?: string;
}
