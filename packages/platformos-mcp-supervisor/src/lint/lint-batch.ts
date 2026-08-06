/**
 * THE lint adapter, over check-node's `lintBuffers` seam.
 *
 * There is no single-buffer counterpart. There was — `lint/lint.ts`, over the
 * `lintBuffer` seam — and the two adapters slowly stopped agreeing about severity
 * mapping and about which paths counted as unchecked, for no better reason than being
 * two copies. The orchestrator always works on a list now, so one file is a batch of
 * one and there is nothing to diverge from.
 *
 * Everything expensive in a lint is per-PROJECT, not per-buffer: resolving the config,
 * walking and reconciling the app, reconciling the route table. Linting N files one call
 * at a time re-discovers the same unchanged project N times.
 *
 * The ratio that motivated batching — ~250 ms fixed against ~84 ms of real per-buffer
 * work — was measured against the EAGER project model, which parsed every file on every
 * call. The lazy `App` has since removed most of that fixed cost (15.3 s → 0.27 s on a
 * 3138-file project), so the numbers above no longer describe this code and are kept only
 * as the reason the shape was chosen. The shape is still right for the reason below,
 * which is not a performance argument at all.
 *
 * And it is more CORRECT, which matters more: with every buffer overlaid at once —
 * in the `App` and in the filesystem view reference checks resolve through — a
 * partial introduced in one buffer resolves for a `render` in another. File-by-file
 * linting reports `MissingPartial` for a file present in the very same request.
 */
import {
  lintBuffers,
  Severity,
  type LintBufferStatus,
  type Offense,
} from '@platformos/platformos-check-node';
// The SAME conversion `lintBuffers` keys its result map with, imported from the package
// that owns it rather than respelled through check-common's equivalent `path.toUri`. The
// two were measured identical on every case that distinguishes them — POSIX, a Windows
// drive letter, non-ASCII, unnormalized segments — but "two normalizers that agree
// today" is not what a map lookup should rest on, and a spelling that disagreed would
// surface as a miss on Windows only. See {@link runBatchLint}'s handling of a miss.
import { uriFromPath } from '@platformos/platformos-common';

import { toAbsoluteFilePath } from '../adapter-input.js';
import type { ValidateCodeDiagnostic, ValidateCodeSeverity } from '../result/types.js';

const SEVERITY: Record<Severity, ValidateCodeSeverity> = {
  [Severity.ERROR]: 'error',
  [Severity.WARNING]: 'warning',
  [Severity.INFO]: 'info',
};

/**
 * Every reason a lint can conclude it did NOT check a file — check-node's own vocabulary,
 * minus the one status that means it did.
 *
 * `Exclude` rather than a respelling, and the whole point is that nothing here restates
 * check-node's list. A status added upstream lands in this type automatically and then
 * fails to compile at the ONE place that has to decide what an agent hears about it
 * (`DECLINE`, in `validate/validate-buffers.ts`). A hand-written union would instead go
 * quietly out of date, and the new status would arrive at runtime as a value no branch
 * covers.
 *
 * This adapter deliberately does NOT translate these into `NotApplicableReason` codes.
 * Two of the five collapse onto one code but keep distinct prose, so the mapping produces
 * a reason AND a message together — one table, in the module that owns refusal wording.
 * Splitting it across two layers here would have meant two tables that must stay in step.
 */
export type LintNotCheckedStatus = Exclude<LintBufferStatus, 'checked'>;

/** One buffer in a batch request, as the caller supplied it. */
export interface BatchBuffer {
  /** File under edit — absolute, or relative to the project root. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/** What one lint pass found, and which requested buffers it did not check — and why. */
export interface BatchLintResult {
  /**
   * Diagnostics per caller key. An empty array means checked and clean.
   *
   * A key appears in EXACTLY ONE of this and {@link notChecked} — or, if the engine
   * returned nothing for it at all, in neither, which the orchestrator's fail safe turns
   * into `internal_error` rather than a clean pass.
   */
  diagnostics: Map<string, ValidateCodeDiagnostic[]>;
  /**
   * Caller keys the lint did NOT check, each with check-node's own reason for it.
   *
   * A MAP, not the `Set` of config-excluded paths this used to be. `lintBuffers` reports
   * four distinct not-checked statuses from the classification and config it has already
   * done, and they carry genuinely different remedies. Flattening them into one "ignored"
   * bucket threw that away and told an author whose partial sits outside the deployed tree
   * that their `.platformos-check.yml` excludes it — advice that cannot be acted on, about
   * a config line that does not exist.
   *
   * Statuses, not prose and not agent-facing codes: this adapter re-keys and partitions,
   * and translating a status into what an agent reads belongs where every other refusal
   * message already lives.
   */
  notChecked: Map<string, LintNotCheckedStatus>;
}

export interface BatchLintInput {
  /** Absolute project root the buffers are validated against. */
  projectDir: string;
  buffers: BatchBuffer[];
}

/**
 * Lint every buffer in one pass, returning diagnostics — and the buffers nothing looked
 * at — keyed by the caller's ORIGINAL `filePath` string.
 *
 * Keyed by the caller's own key on purpose: the caller may pass a relative path, an
 * absolute one, or a mix, and it must be able to find its results without
 * reconstructing our normalization. `lintBuffers` keys by normalized URI, so the
 * mapping back happens here, where both forms are known.
 */
export async function runBatchLint(input: BatchLintInput): Promise<BatchLintResult> {
  const { projectDir, buffers } = input;
  const diagnostics = new Map<string, ValidateCodeDiagnostic[]>();
  const notChecked = new Map<string, LintNotCheckedStatus>();
  if (buffers.length === 0) return { diagnostics, notChecked };

  const absoluteByKey = new Map<string, string>();
  for (const buffer of buffers) {
    absoluteByKey.set(buffer.filePath, toAbsoluteFilePath(projectDir, buffer.filePath));
  }

  const results = await lintBuffers({
    root: projectDir,
    buffers: buffers.map((buffer) => ({
      filePath: absoluteByKey.get(buffer.filePath)!,
      content: buffer.content,
    })),
  });

  // Re-key by the caller's string. `lintBuffers` keys by normalized URI, so match on the
  // same conversion rather than string-comparing paths.
  for (const [key, absolute] of absoluteByKey) {
    const outcome = results.get(uriFromPath(absolute));

    // A MISS SETS NOTHING, and must not. `lintBuffers` is total over the URIs it was
    // handed, so this is unreachable — but the previous spelling defaulted a miss to
    // `[]`, which reports the file CLEAN and is the exact false approval this package
    // exists to prevent. Leaving the key absent instead reaches the orchestrator's fail
    // safe, which answers `internal_error`: "we produced nothing for this file", the only
    // honest thing to say about a lookup that should not have been able to fail.
    if (outcome === undefined) continue;

    if (outcome.status !== 'checked') {
      notChecked.set(key, outcome.status);
      continue;
    }
    diagnostics.set(key, outcome.offenses.map(toDiagnostic));
  }
  return { diagnostics, notChecked };
}

/**
 * Map a check-common `Offense` to a `ValidateCodeDiagnostic`.
 *
 * check-common positions are 0-based for BOTH line and character; the agent surface
 * uses 1-based line + column, so both get `+ 1`. This is the ONLY place the
 * conversion happens — a second copy would be a second chance to disagree about the
 * same offense.
 */
function toDiagnostic(offense: Offense): ValidateCodeDiagnostic {
  return {
    check: offense.check,
    severity: SEVERITY[offense.severity],
    message: offense.message,
    line: offense.start.line + 1,
    column: offense.start.character + 1,
    end_line: offense.end.line + 1,
    end_column: offense.end.character + 1,
  };
}
