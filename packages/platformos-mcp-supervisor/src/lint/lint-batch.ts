/**
 * THE lint adapter, over check-node's `lintBuffers` seam. There is no single-buffer
 * counterpart: the orchestrator always works on a list, so one file is a batch of one.
 *
 * Everything expensive in a lint is per-PROJECT, not per-buffer — resolving the config,
 * walking and reconciling the app, reconciling the route table — so linting N files one
 * call at a time re-discovers the same unchanged project N times.
 *
 * And it is more CORRECT, which matters more: with every buffer overlaid at once — in the
 * `App` and in the filesystem view reference checks resolve through — a partial introduced
 * in one buffer resolves for a `render` in another. File-by-file linting reports
 * `MissingPartial` for a file present in the very same request.
 */
import {
  lintBuffers,
  Severity,
  type LintBufferStatus,
  type LiquidHtmlNode,
  type MaterialisedFix,
  type Offense,
} from '@platformos/platformos-check-node';
// The SAME conversion `lintBuffers` keys its result map with, imported from the package
// that owns it rather than respelled through check-common's equivalent `path.toUri`: a
// spelling that disagreed would surface as a map miss on Windows only.
import { uriFromPath } from '@platformos/platformos-common';

import { toAbsoluteFilePath } from '../adapter-input.js';
import type { ValidateCodeDiagnostic, ValidateCodeSeverity } from '../result/types.js';
import { toAgentFixes } from './fixes.js';

const SEVERITY: Record<Severity, ValidateCodeSeverity> = {
  [Severity.ERROR]: 'error',
  [Severity.WARNING]: 'warning',
  [Severity.INFO]: 'info',
};

/**
 * Every reason a lint can conclude it did NOT check a file — check-node's own vocabulary,
 * minus the one status that means it did.
 *
 * `Exclude` rather than a respelling: a status added upstream lands in this type
 * automatically and then fails to compile at the ONE place that decides what an agent hears
 * about it (`DECLINE`, in `validate/validate-buffers.ts`).
 *
 * This adapter deliberately does NOT translate these into `NotApplicableReason` codes —
 * two of them collapse onto one code but keep distinct prose, so the mapping produces the
 * reason and the message together, in the module that owns refusal wording.
 */
export type LintNotCheckedStatus = Exclude<LintBufferStatus, 'checked'>;

/**
 * What one linted file offers a later stage, beyond the diagnostics themselves.
 *
 * `startIndexes` is INDEX-ALIGNED with that file's `diagnostics` array: entry `i` is where
 * diagnostic `i` starts. Both are produced by one `map` over the same offense list in
 * `runBatchLint`, and `lint-batch.spec.ts` asserts the alignment rather than trusting it.
 *
 * A 0-based offset, not the diagnostic's 1-based line/column: it exists to locate a node in
 * {@link ast}, and that is what `findCurrentNode` takes.
 */
export interface LintedSource {
  /**
   * The buffer's Liquid tree, exactly as check-node captured it inside the overlay — so it
   * describes the text the offenses describe. Absent for GraphQL, YAML and assets, and for
   * a buffer that did not parse.
   */
  ast?: LiquidHtmlNode;
  /** 0-based offense start offsets, index-aligned with this file's diagnostics. */
  startIndexes: number[];
}

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
   * Per file, the material ENRICHMENT needs and the agent surface deliberately does not
   * carry: the buffer's parsed tree, and where in the buffer each diagnostic sits.
   *
   * OPTIONAL for the benefit of test stubs, which have no tree to offer; enrichment
   * degrades to "no symbol hint" without it and still attaches each check's documentation
   * URL. The REAL adapter always sets it, for every key it sets in `diagnostics` —
   * `lint-batch.spec.ts` asserts that, so the leniency here cannot become leniency there.
   */
  sources?: Map<string, LintedSource>;
  /**
   * Caller keys the lint did NOT check, each with check-node's own reason for it. The
   * statuses carry genuinely different remedies, so they are kept distinct rather than
   * flattened into one "ignored" bucket.
   *
   * Statuses, not prose and not agent-facing codes: translating one into what an agent
   * reads belongs where every other refusal message lives.
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
  const sources = new Map<string, LintedSource>();
  const notChecked = new Map<string, LintNotCheckedStatus>();
  if (buffers.length === 0) return { diagnostics, sources, notChecked };

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

    // A MISS SETS NOTHING, and must not: defaulting to `[]` reports the file CLEAN.
    // Leaving the key absent reaches the orchestrator's fail safe, which answers
    // `internal_error` — the only honest thing to say about a lookup that cannot fail.
    if (outcome === undefined) continue;

    if (outcome.status !== 'checked') {
      notChecked.set(key, outcome.status);
      continue;
    }
    // ONE pass produces both, which is what keeps `startIndexes` aligned with
    // `diagnostics`. Splitting this into two loops is how that invariant would break.
    diagnostics.set(
      key,
      outcome.offenses.map((offense, index) => toDiagnostic(offense, outcome.fixes[index])),
    );
    sources.set(key, {
      ast: outcome.ast,
      startIndexes: outcome.offenses.map((offense) => offense.start.index),
    });
  }
  return { diagnostics, sources, notChecked };
}

/**
 * Map a check-common `Offense` to a `ValidateCodeDiagnostic`.
 *
 * check-common positions are 0-based for BOTH line and character; the agent surface uses
 * 1-based line + column, so both get `+ 1`. The ONLY place the conversion happens.
 *
 * TWO COORDINATE SYSTEMS LIVE ON THE RESULT and only one is converted: the edits attached
 * by {@link toAgentFixes} keep the engine's 0-based buffer OFFSETS, because that is what
 * applying an edit requires. Converting those too would corrupt a file.
 */
function toDiagnostic(
  offense: Offense,
  fixes: MaterialisedFix | undefined,
): ValidateCodeDiagnostic {
  return {
    check: offense.check,
    severity: SEVERITY[offense.severity],
    message: offense.message,
    line: offense.start.line + 1,
    column: offense.start.character + 1,
    end_line: offense.end.line + 1,
    end_column: offense.end.character + 1,
    ...toAgentFixes(fixes),
  };
}
