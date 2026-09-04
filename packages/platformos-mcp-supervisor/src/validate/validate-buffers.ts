/**
 * The ONE validation orchestrator. Everything the tool does happens here, and it always
 * works on a LIST of buffers — one file is simply a list of length one. The tool surface
 * adapts shapes; the logic exists once.
 *
 * THE BATCH IS NOT ATOMIC. Every requested buffer gets a result. A refusal declines only
 * ITS buffer, and a merely-unchecked buffer never gates the others.
 *
 * The list is the primitive because validating several buffers together is also more
 * CORRECT: with every buffer overlaid at once, a partial introduced in one resolves for a
 * `render` in another.
 */
import {
  getPlatformOSDocset,
  NodeFileSystem,
  path as pathUtils,
} from '@platformos/platformos-check-node';

import {
  assetNotLinted,
  bufferTooLarge,
  fileApplicability,
  ignoredByProjectConfig,
  misplacedSource,
  notPlatformOSFile,
  toAbsoluteFilePath,
} from '../adapter-input.js';
import { IMPACT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import { enrichDiagnostics, type DocsetVocabulary } from '../enrich/enrich.js';
import { lintDeadlineMs } from '../cost-model.js';
import { TIMED_OUT, withDeadline } from '../deadline.js';
import { runImpact } from '../impact/impact.js';
import { canHaveDependants } from '../impact/dependants.js';
import { createProjectScan, type ProjectScan } from '../impact/project-scan.js';
import {
  runBatchLint,
  type BatchBuffer,
  type BatchLintResult,
  type LintNotCheckedStatus,
} from '../lint/lint-batch.js';
import { assembleNotApplicableResult, assembleResult } from '../result/assemble.js';
import { capToBudget } from '../result/response-budget.js';
import { DISABLED_IMPACT, UNAVAILABLE_IMPACT } from '../result/impact-states.js';
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
  /** Resolve the docset enrichment reads — the one piece of I/O the pure stage cannot do. */
  docset: () => Promise<DocsetVocabulary>;
}

/** Read the process-wide docset and flatten it to the arrays enrichment takes. */
async function resolveDocset(): Promise<DocsetVocabulary> {
  const docset = getPlatformOSDocset();
  const [filters, tags, objects] = await Promise.all([
    docset.filters(),
    docset.tags(),
    docset.objects(),
  ]);
  return { filters, tags, objects };
}

const DEFAULT_ADAPTERS: ValidateAdapters = {
  lint: runBatchLint,
  impact: runImpact,
  docset: resolveDocset,
};

/**
 * check-node's "did not check it" status → the refusal the agent reads, by
 * project-relative path.
 *
 * TOTAL OVER {@link LintNotCheckedStatus} BY TYPE, with no `default` arm: every entry hands
 * back different ADVICE, so a status added upstream must fail the build here rather than
 * fall through to someone else's remedy.
 */
const DECLINE: Record<LintNotCheckedStatus, (relativePath: string) => Declined> = {
  'excluded-by-config': ignoredByProjectConfig,
  'misplaced-source': misplacedSource,
  'not-a-platformos-file': notPlatformOSFile,
  'not-a-source-file': assetNotLinted,
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

  // Computed ONCE and threaded to both the timer and the message that reports it, so the
  // two cannot disagree about the deadline a caller was held to.
  const lintDeadline = lintDeadlineMs(admittedBytes(lintable));

  // The project SCAN overlaps the primary lint; the impact LINT PASSES cannot.
  //
  // `lintBuffers` overlays buffers into check-node's process-shared `App` and reverts them
  // on the way out, and that App has no lock — so two lint passes running at once would
  // corrupt each other. The scan is pure filesystem I/O and touches no App, which is what
  // lets the expensive half of impact hide behind the lint anyway.
  const scan = projectScan(ctx, lintable);
  const [lint] = await Promise.all([
    lintWithDeadline(ctx, adapters, lintable, lintDeadline),
    scan.warm(),
  ]);

  // AFTER the primary lint, and never allowed to break it: the write gate is already
  // decided by this point, so impact can only add to the answer or fail quietly.
  //
  // Turned off for this SERVER (`--no-impact`) it costs NOTHING: `projectScan` declines to
  // read, and the two extra lint passes never start. `disabled` is its own status precisely
  // so an agent does not read it as a failure worth retrying.
  const impacts =
    ctx.impactEnabled === false
      ? new Map(lintable.map((buffer) => [buffer.filePath, DISABLED_IMPACT()]))
      : await impactWithDeadline(ctx, adapters, lintable, scan.scan);

  // The lint pass is what knows which buffers were not checked and why — it holds the
  // config AND the classifier. Folding its answer in here keeps ONE source of truth for
  // "is this file part of the app".
  if (lint !== TIMED_OUT) {
    const rootUri = pathUtils.toUri(ctx.projectDir);
    for (const [key, status] of lint.notChecked) {
      const absolute = pathUtils.toUri(toAbsoluteFilePath(ctx.projectDir, key));
      declined.set(key, DECLINE[status](pathUtils.relative(absolute, rootUri)));
    }
  }

  const diagnostics = lint === TIMED_OUT ? TIMED_OUT : await enrich(ctx, lint, adapters.docset);

  // The response bound is applied LAST, to finished results: `resultFor` has already
  // computed `status` and `must_fix_before_write` from the complete diagnostic set, so the
  // cap can only shorten lists — it has no way to soften a verdict.
  return capToBudget(
    new Map(
      buffers.map((buffer) => [
        buffer.filePath,
        resultFor(buffer.filePath, declined, diagnostics, impacts, lintDeadline),
      ]),
    ),
  );
}

/**
 * Split the requested buffers into those this server declines outright and those it will
 * send to the lint.
 *
 * PURE and synchronous. Every refusal decidable without I/O happens here — outside the
 * project root, an unsupported file type, over the size bound — so a declined buffer costs
 * nothing and never reaches the engine.
 *
 * Config-level exclusion and telling a MISPLACED source from an unsupported one both need
 * the project, so they are decided by the lint pass instead and folded in by
 * {@link validateBuffers} through {@link DECLINE}.
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
 * The deadline is a backstop against an async stall, NOT cancellation: a synchronous parse
 * blocks the event loop and the timer cannot even fire during it (see `deadline.ts`). What
 * bounds CPU-bound work is `MAX_BUFFER_BYTES` and `MAX_BATCH_BYTES`.
 *
 * It is sized from the bytes ACTUALLY ADMITTED, since those are the only ones the lint
 * will spend time on.
 */
async function lintWithDeadline(
  ctx: SupervisorContext,
  adapters: ValidateAdapters,
  lintable: BatchBuffer[],
  deadline: number,
): Promise<BatchLintResult | typeof TIMED_OUT> {
  if (lintable.length === 0)
    return { diagnostics: new Map(), sources: new Map(), notChecked: new Map() };

  const work = adapters.lint({ projectDir: ctx.projectDir, buffers: lintable });
  const outcome = await withDeadline(work, deadline);
  if (outcome !== TIMED_OUT) return outcome;

  observeAbandoned(ctx, work, 'lint');
  ctx.log(`validate_code: lint exceeded ${deadline} ms`);
  return TIMED_OUT;
}

/**
 * Attach the check's documentation URL and the docset entry for the symbol each diagnostic
 * is about.
 *
 * THE ONLY I/O HERE IS RESOLVING THE DOCSET, at this edge rather than inside `enrich/`,
 * which is a pure function of data.
 *
 * FAILING TO ENRICH MUST NOT FAIL THE CALL: a throw degrades to the un-enriched
 * diagnostics and is logged, rather than reporting a broken file as unchecked.
 *
 * NOTHING TO ENRICH MEANS NO I/O AT ALL — resolving the docset would pay
 * `PlatformOSLiquidDocsManager.setup()`'s network revision check for nothing.
 */
async function enrich(
  ctx: SupervisorContext,
  lint: BatchLintResult,
  resolve: ValidateAdapters['docset'],
): Promise<Map<string, ValidateCodeDiagnostic[]>> {
  let found = 0;
  for (const diagnostics of lint.diagnostics.values()) found += diagnostics.length;
  if (found === 0) return lint.diagnostics;

  try {
    // ONCE per request, not once per file: the vocabulary is the same for every buffer.
    const vocabulary = await resolve();

    return new Map(
      [...lint.diagnostics].map(([key, diagnostics]) => {
        const source = lint.sources?.get(key);
        // `startIndexes` is index-aligned with `diagnostics` by construction in
        // `runBatchLint`; a missing entry can only mean the two got out of step, so the
        // offset is passed as ABSENT rather than as an out-of-range sentinel that would
        // resolve to some unrelated symbol.
        const inputs = diagnostics.map((diagnostic, index) => ({
          diagnostic,
          startIndex: source?.startIndexes[index],
        }));
        return [key, enrichDiagnostics(inputs, { ast: source?.ast, vocabulary })];
      }),
    );
  } catch (error: unknown) {
    ctx.log(`validate_code: enrichment failed, returning findings unenriched: ${describe(error)}`);
    return lint.diagnostics;
  }
}

/** Total UTF-8 bytes handed to the lint — what the deadline is sized against. */
function admittedBytes(lintable: readonly BatchBuffer[]): number {
  return lintable.reduce((total, buffer) => total + Buffer.byteLength(buffer.content, 'utf8'), 0);
}

/**
 * Impact per lintable buffer.
 *
 * ONE scan serves the whole batch: `createProjectScan` reads the project's edge sources once,
 * LAZILY and memoized, so a batch whose buffers can have no dependants never reads the project
 * at all, and one where some can pays a single read. The batch's own buffers are overlaid into
 * it, so a call a buffer has just added counts.
 *
 * The set shares one tight deadline because impact is discardable enrichment —
 * `unavailable` already means "we don't know".
 */
async function impactWithDeadline(
  ctx: SupervisorContext,
  adapters: ValidateAdapters,
  lintable: BatchBuffer[],
  scan: ProjectScan,
): Promise<Map<string, ValidateCodeImpact>> {
  const byFile = new Map<string, ValidateCodeImpact>();
  if (lintable.length === 0) return byFile;

  const work = adapters
    .impact({
      projectDir: ctx.projectDir,
      buffers: lintable,
      scan,
      lint: adapters.lint,
      docset: adapters.docset,
      log: (message) => ctx.log(`validate_code: ${message}`),
    })
    .catch((error: unknown) => {
      // ONE failure covers the whole changeset: the passes are shared, so a failure says
      // nothing about any individual buffer.
      ctx.log(`validate_code: impact failed: ${describe(error)}`);
      return new Map<string, ValidateCodeImpact>();
    });

  const outcome = await withDeadline(work, IMPACT_DEADLINE_MS);
  if (outcome === TIMED_OUT) {
    observeAbandoned(ctx, work, 'impact');
    ctx.log(`validate_code: impact exceeded ${IMPACT_DEADLINE_MS} ms, continuing without it`);
    for (const buffer of lintable) byFile.set(buffer.filePath, UNAVAILABLE_IMPACT());
    return byFile;
  }

  // A buffer the pass did not answer for gets `unavailable` rather than a silent absence:
  // `resultFor` would otherwise default it, and "we did not look" must not read as "we
  // looked and found nothing".
  for (const buffer of lintable) {
    byFile.set(buffer.filePath, outcome.get(buffer.filePath) ?? UNAVAILABLE_IMPACT());
  }
  return byFile;
}

/**
 * The request's project scan, plus a handle to start reading it.
 *
 * Split so the read can be STARTED alongside the primary lint and awaited later: it is the
 * expensive half of impact (~235 ms on a 2,615-file project) and pure filesystem I/O, so
 * overlapping it with the lint's CPU costs nothing and races nothing.
 */
function projectScan(
  ctx: SupervisorContext,
  lintable: readonly BatchBuffer[],
): { scan: ProjectScan; warm: () => Promise<unknown> } {
  const rootUri = pathUtils.normalize(pathUtils.toUri(ctx.projectDir));
  const scan = createProjectScan(
    rootUri,
    NodeFileSystem,
    new Map(
      lintable.map((buffer) => [
        pathUtils.normalize(pathUtils.toUri(toAbsoluteFilePath(ctx.projectDir, buffer.filePath))),
        buffer.content,
      ]),
    ),
  );
  // Nothing in this changeset can HAVE dependants — every buffer is a YAML file, or sits in
  // no platformOS directory — so impact will never consult the scan and reading the project
  // would be pure waste. Decidable from the paths alone, before any I/O.
  //
  // A PERFORMANCE GUARD, NOT A CORRECTNESS ONE, which is why six mutants survive on it.
  // `warm()` only PRE-warms: `scan.sources()` memoizes its promise and impact awaits that
  // same promise itself, so inverting this buys a wasted read or a colder path, never a
  // different answer. Nothing pins it — nor the `--no-impact` claim above, where what is
  // tested is that the impact ADAPTER goes uncalled, not that the project read is skipped.
  const worthReading =
    ctx.impactEnabled !== false &&
    lintable.some((buffer) =>
      canHaveDependants(
        pathUtils.normalize(pathUtils.toUri(toAbsoluteFilePath(ctx.projectDir, buffer.filePath))),
        rootUri,
      ),
    );

  return {
    scan,
    // A failed read is impact's problem, not the lint's: swallowed here so it cannot reject
    // the `Promise.all` that the primary lint is riding in, and surfaced when impact awaits
    // the same memoized promise itself.
    warm: () => (worthReading ? scan.sources().catch(() => undefined) : Promise.resolve()),
  };
}

/**
 * Attach a handler to work the deadline abandoned.
 *
 * The promise is STILL RUNNING and now unobserved, so a later rejection would surface as
 * an unhandled rejection — fatal under Node's default. Logged rather than swallowed.
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
    // FAIL SAFE. Unreachable: `runBatchLint` seeds an entry for every requested key. But
    // defaulting to `[]` would report a file CLEAN that was never linted.
    return assembleNotApplicableResult({
      code: 'internal_error',
      reason:
        `No result was produced for \`${filePath}\`, so nothing was checked. This is a bug in ` +
        `the validator, not a verdict on the file — treat it as "unknown" and please report it.`,
    });
  }

  return assembleResult(forFile, impacts.get(filePath) ?? UNAVAILABLE_IMPACT());
}
