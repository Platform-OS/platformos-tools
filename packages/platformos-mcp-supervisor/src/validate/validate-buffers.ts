/**
 * The ONE validation orchestrator. Everything the tool does happens here, and it
 * always works on a LIST of buffers — one file is simply a list of length one.
 *
 * WHY ONE PATH. There were briefly two orchestrators, one per tool, running the
 * identical five steps (decline → ignore → lint → impact → assemble). They
 * immediately drifted: two copies of `UNAVAILABLE_IMPACT`, two differently-worded
 * timeout messages, the same narrowing helper under two names, and lint/impact
 * running concurrently in one and sequentially in the other. None of that was
 * intentional — it is just what two copies of a procedure do. The tool surface
 * adapts shapes; the logic exists once.
 *
 * THE BATCH IS NOT ATOMIC. Every requested buffer gets a result. A refusal declines
 * only ITS buffer, and a merely-unchecked buffer never gates the others.
 *
 * VALIDATING SEVERAL BUFFERS TOGETHER IS ALSO MORE CORRECT, which is the real
 * reason the list is the primitive rather than an optimisation bolted on: with every
 * buffer overlaid at once, a partial introduced in one resolves for a `render` in
 * another. Checking the same coordinated edit one file at a time reports
 * `MissingPartial` for a file present in the very same changeset.
 */
import { ignoredByConfig, path as pathUtils } from '@platformos/platformos-check-node';

import {
  bufferTooLarge,
  fileApplicability,
  ignoredByProjectConfig,
  toAbsoluteFilePath,
} from '../adapter-input.js';
import { IMPACT_DEADLINE_MS, LINT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import { TIMED_OUT, withDeadline } from '../deadline.js';
import { runImpact } from '../impact/impact.js';
import { runBatchLint, type BatchBuffer } from '../lint/lint-batch.js';
import { assembleNotApplicableResult, assembleResult } from '../result/assemble.js';
import { COMPUTING_IMPACT, UNAVAILABLE_IMPACT } from '../result/impact-states.js';
import type {
  Declined,
  ValidateCodeDiagnostic,
  ValidateCodeImpact,
  ValidateCodeResult,
} from '../result/types.js';

/** One buffer to validate, keyed by the caller's own path string. */
export interface BufferToValidate {
  /** File under edit — absolute, or relative to the project root, exactly as given. */
  filePath: string;
  content: string;
}

/** The I/O seams the orchestrator drives. Injectable so the contract is unit-testable. */
export interface ValidateAdapters {
  lint: typeof runBatchLint;
  impact: typeof runImpact;
  /** Which requested paths the project config excludes from linting entirely. */
  ignored: typeof ignoredByConfig;
}

const DEFAULT_ADAPTERS: ValidateAdapters = {
  lint: runBatchLint,
  impact: runImpact,
  ignored: ignoredByConfig,
};

/**
 * Validate every buffer, returning one result per buffer keyed by the caller's own
 * `filePath` string.
 *
 * Keyed by the caller's key rather than a normalized URI so a caller that mixes
 * relative and absolute paths can find its own results without reproducing our
 * normalization.
 */
export async function validateBuffers(
  ctx: SupervisorContext,
  buffers: readonly BufferToValidate[],
  overrides: Partial<ValidateAdapters> = {},
): Promise<Map<string, ValidateCodeResult>> {
  const adapters = { ...DEFAULT_ADAPTERS, ...overrides };

  const { declined, lintable } = await partition(ctx, buffers, adapters);

  // Concurrently: the lint is the long pole and impact must hide behind it. Running
  // these in sequence added the whole blast-radius cost (~142 ms) to every call.
  const [diagnostics, impacts] = await Promise.all([
    lintWithDeadline(ctx, adapters, lintable),
    impactWithDeadline(ctx, adapters, lintable),
  ]);

  return new Map(
    buffers.map((buffer) => [
      buffer.filePath,
      resultFor(buffer.filePath, declined, diagnostics, impacts),
    ]),
  );
}

/**
 * Split the requested buffers into those this server declines to judge and those it
 * will lint.
 *
 * Two kinds of refusal, in order, because they need different things:
 *
 *   1. PURE, per buffer — outside the project root, an unsupported file type, or
 *      over the size bound. No I/O, so it runs first and an off-project path never
 *      triggers a config load.
 *   2. CONFIG-DRIVEN — excluded by the project's `ignore` list. Needs the project
 *      config, and one load answers the whole batch. `check()` skips ignored files
 *      SILENTLY, so without this an ignored file came back `ok`: the write gate
 *      approving a file nothing had looked at.
 */
async function partition(
  ctx: SupervisorContext,
  buffers: readonly BufferToValidate[],
  adapters: ValidateAdapters,
): Promise<{ declined: Map<string, Declined>; lintable: BatchBuffer[] }> {
  const declined = new Map<string, Declined>();
  const lintable: BatchBuffer[] = [];

  for (const buffer of buffers) {
    const refusal = refuse(ctx.projectDir, buffer);
    if (refusal) {
      declined.set(buffer.filePath, refusal);
      continue;
    }
    lintable.push({ filePath: buffer.filePath, content: buffer.content });
  }

  if (lintable.length === 0) return { declined, lintable };

  const absoluteByKey = new Map(
    lintable.map((buffer) => [
      buffer.filePath,
      toAbsoluteFilePath(ctx.projectDir, buffer.filePath),
    ]),
  );
  const ignored = await adapters.ignored(ctx.projectDir, [...absoluteByKey.values()]);
  if (ignored.size === 0) return { declined, lintable };

  const rootUri = pathUtils.normalize(pathUtils.URI.file(ctx.projectDir));
  for (const [key, absolute] of absoluteByKey) {
    if (!ignored.has(absolute)) continue;
    declined.set(
      key,
      ignoredByProjectConfig(
        pathUtils.relative(pathUtils.normalize(pathUtils.URI.file(absolute)), rootUri),
      ),
    );
  }

  // Drop them from the lint — `check()` would skip them anyway.
  return { declined, lintable: lintable.filter((buffer) => !declined.has(buffer.filePath)) };
}

/** The pure, per-buffer refusal for this buffer, if any. */
function refuse(projectDir: string, buffer: BufferToValidate): Declined | undefined {
  const applicability = fileApplicability(projectDir, buffer.filePath);
  if (!applicability.applicable) return applicability;
  return bufferTooLarge(buffer.content);
}

type DiagnosticsByFile = Map<string, ValidateCodeDiagnostic[]>;

/**
 * Lint every lintable buffer in ONE project pass, or {@link TIMED_OUT}.
 *
 * The deadline is a backstop against an async stall, NOT cancellation: a
 * synchronous parse blocks the event loop and the timer cannot even fire during it
 * (see `deadline.ts`). What bounds CPU-bound work is `MAX_BUFFER_BYTES`.
 */
async function lintWithDeadline(
  ctx: SupervisorContext,
  adapters: ValidateAdapters,
  lintable: BatchBuffer[],
): Promise<DiagnosticsByFile | typeof TIMED_OUT> {
  if (lintable.length === 0) return new Map();

  const work = adapters.lint({ projectDir: ctx.projectDir, buffers: lintable }, ctx.appCache);
  const outcome = await withDeadline(work, LINT_DEADLINE_MS);
  if (outcome !== TIMED_OUT) return outcome;

  observeAbandoned(ctx, work, 'lint');
  ctx.log(`validate_code: lint exceeded ${LINT_DEADLINE_MS} ms`);
  return TIMED_OUT;
}

/**
 * Blast radius per lintable buffer.
 *
 * `runImpact` reads the same cached graph for every buffer, so this does not re-walk
 * the project per file; the concurrency only overlaps the per-file shaping. The set
 * shares one tight deadline because impact is discardable enrichment — losing it
 * costs freshness, and `unavailable` already means "we don't know".
 */
async function impactWithDeadline(
  ctx: SupervisorContext,
  adapters: ValidateAdapters,
  lintable: BatchBuffer[],
): Promise<Map<string, ValidateCodeImpact>> {
  const byFile = new Map<string, ValidateCodeImpact>();
  if (lintable.length === 0) return byFile;

  const work = Promise.all(
    lintable.map(async (buffer) => {
      const impact = await adapters
        .impact(
          { projectDir: ctx.projectDir, filePath: buffer.filePath, content: buffer.content },
          ctx.graphCache,
        )
        .catch((error: unknown) => {
          ctx.log(`validate_code: blast-radius failed for ${buffer.filePath}: ${describe(error)}`);
          return UNAVAILABLE_IMPACT();
        });
      return [buffer.filePath, impact] as const;
    }),
  );

  const outcome = await withDeadline(work, IMPACT_DEADLINE_MS);
  if (outcome === TIMED_OUT) {
    observeAbandoned(ctx, work, 'blast-radius');
    ctx.log(`validate_code: blast-radius exceeded ${IMPACT_DEADLINE_MS} ms, continuing without it`);
    for (const buffer of lintable) byFile.set(buffer.filePath, UNAVAILABLE_IMPACT());
    return byFile;
  }

  for (const [filePath, impact] of outcome) byFile.set(filePath, impact);
  return byFile;
}

/**
 * Attach a handler to work the deadline abandoned.
 *
 * The promise is STILL RUNNING and now unobserved, so a later rejection would
 * surface as an unhandled rejection somewhere unrelated — and under Node's default
 * that is fatal. Logging rather than swallowing, so a real fault is still visible.
 */
function observeAbandoned(ctx: SupervisorContext, work: Promise<unknown>, what: string): void {
  work.catch((error: unknown) => {
    ctx.log(`validate_code: abandoned ${what} later failed: ${describe(error)}`);
  });
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function resultFor(
  filePath: string,
  declined: ReadonlyMap<string, Declined>,
  diagnostics: DiagnosticsByFile | typeof TIMED_OUT,
  impacts: ReadonlyMap<string, ValidateCodeImpact>,
): ValidateCodeResult {
  const refusal = declined.get(filePath);
  if (refusal) return assembleNotApplicableResult(refusal);

  if (diagnostics === TIMED_OUT) {
    return assembleNotApplicableResult({
      code: 'timed_out',
      reason:
        `Validation exceeded ${Math.round(LINT_DEADLINE_MS / 1000)} s and was abandoned, so ` +
        `nothing conclusive was checked for \`${filePath}\`. Treat this as "unknown", not as a ` +
        `verdict on the file. Retrying — with fewer files, if this was a batch — may succeed.`,
    });
  }

  const forFile = diagnostics.get(filePath);
  if (forFile === undefined) {
    // FAIL SAFE. Unreachable: `runBatchLint` seeds an entry for every requested key.
    // But defaulting a missing entry to `[]` would report a file CLEAN that was
    // never linted — precisely the false approval this area exists to prevent.
    return assembleNotApplicableResult({
      code: 'internal_error',
      reason:
        `No result was produced for \`${filePath}\`, so nothing was checked. This is a bug in ` +
        `the validator, not a verdict on the file — treat it as "unknown" and please report it.`,
    });
  }

  return assembleResult(forFile, impacts.get(filePath) ?? COMPUTING_IMPACT());
}
