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
import { path as pathUtils } from '@platformos/platformos-check-node';

import {
  bufferTooLarge,
  fileApplicability,
  ignoredByProjectConfig,
  toAbsoluteFilePath,
} from '../adapter-input.js';
import { IMPACT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import { lintDeadlineMs } from '../cost-model.js';
import { TIMED_OUT, withDeadline } from '../deadline.js';
import { runImpact } from '../impact/impact.js';
import { runBatchLint, type BatchBuffer, type BatchLintResult } from '../lint/lint-batch.js';
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
}

const DEFAULT_ADAPTERS: ValidateAdapters = {
  lint: runBatchLint,
  impact: runImpact,
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

  const { declined, lintable } = partition(ctx.projectDir, buffers);

  // Computed ONCE and threaded to both the timer and the message that reports it.
  // Deriving it twice would let the two disagree about the deadline a caller was
  // actually held to, and the message is the only place a caller can see it.
  const lintDeadline = lintDeadlineMs(admittedBytes(lintable));

  // Concurrently: the lint is the long pole and impact must hide behind it. Running
  // these in sequence added the whole blast-radius cost (~142 ms) to every call.
  const [lint, impacts] = await Promise.all([
    lintWithDeadline(ctx, adapters, lintable, lintDeadline),
    impactWithDeadline(ctx, adapters, lintable),
  ]);

  // The lint pass is what knows which buffers the project config excludes — it holds
  // the config. Folding its answer in here keeps ONE config load and one source of
  // truth for "is this file part of the app".
  if (lint !== TIMED_OUT) {
    const rootUri = pathUtils.toUri(ctx.projectDir);
    for (const key of lint.ignored) {
      const absolute = pathUtils.toUri(toAbsoluteFilePath(ctx.projectDir, key));
      declined.set(key, ignoredByProjectConfig(pathUtils.relative(absolute, rootUri)));
    }
  }

  const diagnostics = lint === TIMED_OUT ? TIMED_OUT : lint.diagnostics;

  return new Map(
    buffers.map((buffer) => [
      buffer.filePath,
      resultFor(buffer.filePath, declined, diagnostics, impacts, lintDeadline),
    ]),
  );
}

/**
 * Split the requested buffers into those this server declines outright and those it
 * will send to the lint.
 *
 * PURE and synchronous. Every refusal decidable without I/O happens here — outside
 * the project root, an unsupported file type, over the size bound — so a declined
 * buffer costs nothing and never reaches the engine.
 *
 * Config-level exclusion is deliberately NOT here. It needs the project config, and
 * the lint pass already loads one; asking separately meant a second config load and,
 * worse, a second source of truth for "is this file part of the app". `lintBuffers`
 * reports it instead (see `LintBuffersResult`), and {@link validateBuffers} folds
 * that answer in afterwards.
 */
function partition(
  projectDir: string,
  buffers: readonly BufferToValidate[],
): { declined: Map<string, Declined>; lintable: BatchBuffer[] } {
  const declined = new Map<string, Declined>();
  const lintable: BatchBuffer[] = [];

  for (const buffer of buffers) {
    const refusal = refuse(projectDir, buffer);
    if (refusal) {
      declined.set(buffer.filePath, refusal);
      continue;
    }
    lintable.push({ filePath: buffer.filePath, content: buffer.content });
  }

  return { declined, lintable };
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
 * (see `deadline.ts`). What bounds CPU-bound work is `MAX_BUFFER_BYTES` and
 * `MAX_BATCH_BYTES`.
 *
 * It is sized from the bytes ACTUALLY ADMITTED — the lintable ones, after the
 * declined buffers were dropped — because those are the only ones the lint will
 * spend time on. Charging a request for a 200 KiB buffer that was refused unread
 * would grant a deadline for work nobody is doing.
 */
async function lintWithDeadline(
  ctx: SupervisorContext,
  adapters: ValidateAdapters,
  lintable: BatchBuffer[],
  deadline: number,
): Promise<BatchLintResult | typeof TIMED_OUT> {
  if (lintable.length === 0) return { diagnostics: new Map(), ignored: new Set() };

  const work = adapters.lint({ projectDir: ctx.projectDir, buffers: lintable }, ctx.appCache);
  const outcome = await withDeadline(work, deadline);
  if (outcome !== TIMED_OUT) return outcome;

  observeAbandoned(ctx, work, 'lint');
  ctx.log(`validate_code: lint exceeded ${deadline} ms`);
  return TIMED_OUT;
}

/** Total UTF-8 bytes handed to the lint — what the deadline is sized against. */
function admittedBytes(lintable: readonly BatchBuffer[]): number {
  return lintable.reduce((total, buffer) => total + Buffer.byteLength(buffer.content, 'utf8'), 0);
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
  lintDeadline: number,
): ValidateCodeResult {
  const refusal = declined.get(filePath);
  if (refusal) return assembleNotApplicableResult(refusal);

  if (diagnostics === TIMED_OUT) {
    return assembleNotApplicableResult({
      code: 'timed_out',
      reason:
        `Validation exceeded ${Math.round(lintDeadline / 1000)} s and was abandoned, so ` +
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
