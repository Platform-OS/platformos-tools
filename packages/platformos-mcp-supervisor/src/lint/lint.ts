/**
 * Lint adapter — the only I/O boundary on the request path.
 *
 * Lints an in-memory buffer in the context of its on-disk project via the
 * check-node `lintBuffer` seam (a direct `check()` call — no LSP, no
 * subprocess) and maps the structured check-common `Offense[]` into the
 * agent-facing `ValidateCodeDiagnostic` shape.
 *
 * This is the minimal "lint only" slice: it carries detection results
 * (check code, severity, message, range) straight through. Ergonomic
 * enrichment (hints, confidence, fix translation, see-also) is added later in
 * `enrich/`; for now diagnostics have no `fix` / `hint`, and the structured
 * `Offense.fix` / `suggest` are intentionally not translated.
 */
import { isAbsolute, join } from 'node:path';

import { lintBuffer, Severity, type Offense } from '@platformos/platformos-check-node';

import type { ValidateCodeDiagnostic, ValidateCodeSeverity } from '../result/types.js';

export interface RunLintParams {
  /** Absolute project root the buffer is validated against. */
  projectDir: string;
  /** File under edit — absolute, or relative to `projectDir`. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

const SEVERITY: Record<Severity, ValidateCodeSeverity> = {
  [Severity.ERROR]: 'error',
  [Severity.WARNING]: 'warning',
  [Severity.INFO]: 'info',
};

/** Lint the buffer and return the mapped diagnostics for the file. */
export async function runLint(params: RunLintParams): Promise<ValidateCodeDiagnostic[]> {
  const { projectDir, filePath, content } = params;
  const absoluteFilePath = isAbsolute(filePath) ? filePath : join(projectDir, filePath);
  const offenses = await lintBuffer({ root: projectDir, filePath: absoluteFilePath, content });
  return offenses.map(toDiagnostic);
}

/**
 * Map a check-common `Offense` to a `ValidateCodeDiagnostic`.
 *
 * check-common positions are 0-based for BOTH line and character
 * (`getPosition` uses `line-column` with `origin: 0`); the agent surface uses
 * 1-based line + 1-based column, so both get `+ 1`.
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
