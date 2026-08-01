/**
 * Batch lint adapter — the multi-buffer counterpart of `lint/lint.ts`, over
 * check-node's `lintBuffers` seam.
 *
 * Everything expensive in a lint is per-PROJECT, not per-buffer: loading the
 * config, globbing and reconciling the app, building the `getDocDefinition` map,
 * constructing the `JSONValidator`. Measured at ~250 ms of fixed cost against
 * ~84 ms of real per-buffer work, so linting N files one call at a time spent most
 * of its time re-discovering the same unchanged project N times.
 *
 * And it is more CORRECT, which matters more: with every buffer overlaid at once —
 * in the `App` and in the filesystem view reference checks resolve through — a
 * partial introduced in one buffer resolves for a `render` in another. File-by-file
 * linting reports `MissingPartial` for a file present in the very same request.
 */
import { path as pathUtils } from '@platformos/platformos-check-common';
import {
  lintBuffers,
  Severity,
  type AppCache,
  type Offense,
} from '@platformos/platformos-check-node';

import { toAbsoluteFilePath } from '../adapter-input.js';
import type { ValidateCodeDiagnostic, ValidateCodeSeverity } from '../result/types.js';

const SEVERITY: Record<Severity, ValidateCodeSeverity> = {
  [Severity.ERROR]: 'error',
  [Severity.WARNING]: 'warning',
  [Severity.INFO]: 'info',
};

/** One buffer in a batch request, as the caller supplied it. */
export interface BatchBuffer {
  /** File under edit — absolute, or relative to the project root. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/** What one lint pass found, and which requested buffers it did not check. */
export interface BatchLintResult {
  /** Diagnostics per caller key. An empty array means checked and clean. */
  diagnostics: Map<string, ValidateCodeDiagnostic[]>;
  /**
   * Caller keys the project config excludes — NOT checked. Reported by
   * `lintBuffers` from the config it already loaded, so this costs no extra I/O and
   * cannot disagree with what the engine actually skipped.
   */
  ignored: Set<string>;
}

export interface BatchLintInput {
  /** Absolute project root the buffers are validated against. */
  projectDir: string;
  buffers: BatchBuffer[];
}

/**
 * Lint every buffer in one pass, returning diagnostics — and the config-excluded
 * buffers — keyed by the caller's ORIGINAL `filePath` string.
 *
 * Keyed by the caller's own key on purpose: the caller may pass a relative path, an
 * absolute one, or a mix, and it must be able to find its results without
 * reconstructing our normalization. `lintBuffers` keys by normalized URI, so the
 * mapping back happens here, where both forms are known.
 */
export async function runBatchLint(
  input: BatchLintInput,
  cache?: AppCache,
): Promise<BatchLintResult> {
  const { projectDir, buffers } = input;
  const diagnostics = new Map<string, ValidateCodeDiagnostic[]>();
  const ignored = new Set<string>();
  if (buffers.length === 0) return { diagnostics, ignored };

  const absoluteByKey = new Map<string, string>();
  for (const buffer of buffers) {
    absoluteByKey.set(buffer.filePath, toAbsoluteFilePath(projectDir, buffer.filePath));
  }

  const result = await lintBuffers({
    root: projectDir,
    buffers: buffers.map((buffer) => ({
      filePath: absoluteByKey.get(buffer.filePath)!,
      content: buffer.content,
    })),
    cache,
  });

  // Re-key by the caller's string. `lintBuffers` normalizes to a URI, so match on
  // the same normalization rather than string-comparing paths.
  for (const [key, absolute] of absoluteByKey) {
    const uri = pathUtils.toUri(absolute);
    if (result.ignored.has(uri)) {
      ignored.add(key);
      continue;
    }
    diagnostics.set(key, (result.offenses.get(uri) ?? []).map(toDiagnostic));
  }
  return { diagnostics, ignored };
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
