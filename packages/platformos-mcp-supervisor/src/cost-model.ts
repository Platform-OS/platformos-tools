/**
 * What a lint COSTS — and therefore how much work one request may admit, and how long the
 * server waits for it.
 *
 * The byte caps and the deadline are ONE relationship, written here as arithmetic and
 * derived rather than chosen. Adding per-node work moves {@link LINT_MS_PER_KIB} and every
 * dependent bound follows; `cost-model.spec.ts` fails if any of them stops fitting. A batch
 * admitted past its deadline returns `timed_out` for EVERY file in the request, so the two
 * drifting apart fails quietly and in the expensive direction.
 *
 * THE DEADLINE SCALES WITH THE REQUEST because a fixed one and a meaningful batch cap
 * cannot both exist: hold it at 60 s and the largest admissible batch is ~133 KiB, smaller
 * than a single legal buffer. Scaling costs little — this deadline is a backstop for ASYNC
 * stalls (see `deadline.ts`) rather than a CPU bound.
 *
 * Every number here is MEASURED, and the measurement is named. A plausible constant is how
 * this file rots back into unrelated magic numbers.
 */

/**
 * Wall-clock cost of linting one KiB of buffer, on an idle machine, warm cache.
 *
 * Measured end to end (`runValidateCode`, the whole request path), not against the parse
 * alone. Reproduce with `scripts/measure-lint-cost.mjs`, which builds a synthetic project
 * and prints the rate for a single buffer and for batch shapes; the slowest observed was
 * ~51 ms/KiB, on CLEAN markup rather than the diagnostic-dense shape.
 *
 * DO NOT LOWER THIS TO MATCH A FASTER MEASUREMENT. The rate varies by several times with
 * the project and the markup, so the constant is deliberately set above the slowest
 * observed value. Being wrong FAST costs a longer wait before a stall is declared; being
 * wrong SLOW admits a request that cannot finish and returns `timed_out` for every file.
 */
export const LINT_MS_PER_KIB = 75;

/**
 * How much slower the same lint runs on a contended machine than on an idle one.
 *
 * Measured at ~2.3x (128 KiB: ~10 s idle, ~23 s under load), held at 3 because it bounds
 * someone else's machine. Being wrong low produces a false `timed_out` — a silent
 * no-answer — while being wrong high costs only a longer wait before declaring a stall.
 */
export const LOAD_FACTOR = 3;

/**
 * How far beyond the expected loaded worst case the deadline sits. The deadline must never
 * fire on work that was legal to admit; it exists to catch a stall.
 */
export const DEADLINE_MARGIN = 2;

/** Deadline granted per KiB of admitted work: idle cost, under load, with margin. */
export const DEADLINE_MS_PER_KIB = LINT_MS_PER_KIB * LOAD_FACTOR * DEADLINE_MARGIN;

/**
 * Deadline floor, applied to every request however small.
 *
 * Small requests are not dominated by their buffers: a cold first call also builds the app,
 * loads the config and reconciles the graph (~0.8 s idle, ~1.6 s loaded on a 162-file
 * project). The floor covers that fixed cost with room to spare.
 */
export const MIN_LINT_DEADLINE_MS = 60_000;

/**
 * Deadline ceiling, and therefore the origin of {@link maxBytesWithin}'s answer for the
 * batch cap.
 *
 * POLICY rather than measurement: how long the server holds a request open before
 * concluding it has stalled. Two minutes is past the point where an agent has any use for
 * the answer, and every extra second of ceiling buys a larger admissible batch.
 */
export const MAX_LINT_DEADLINE_MS = 120_000;

/**
 * How much of the AGENT'S CONTEXT one `validate_code` answer may spend.
 *
 * POLICY, like {@link MAX_LINT_DEADLINE_MS}, and the one bound here that is not about the
 * server's own work. Unbounded, a legal call was measured returning ~336 000 tokens — more
 * than most context windows hold, with nothing in the payload saying so.
 *
 * At ~153 bytes per diagnostic this budget holds roughly 200 findings. Measured real calls
 * cost tens to hundreds of tokens, so the cap cannot touch them; what it defends against is
 * the tail — a generated file, or one cascading syntax error in a large partial.
 */
export const RESPONSE_TOKEN_BUDGET = 8_000;

/**
 * Bytes per token, for converting the budget above into something countable.
 *
 * A crude ESTIMATE — this JSON is mostly ASCII prose, where ~4 bytes/token is the usual
 * rule of thumb, and the real tokenizer is the client's. Being wrong by 25% moves the cap
 * between ~150 and ~250 diagnostics, which changes nothing about which calls it affects.
 */
export const BYTES_PER_TOKEN = 4;

/**
 * The bound actually enforced: serialized bytes of diagnostics one response may
 * carry, across the WHOLE request rather than per file.
 *
 * Per-request because per-file alone leaves the worst case multiplied by the file
 * count — 50 files each just under a per-file cap is 50x the intended bound, and the
 * batch form exists precisely so agents send many files at once.
 */
export const MAX_RESPONSE_DIAGNOSTIC_BYTES = RESPONSE_TOKEN_BUDGET * BYTES_PER_TOKEN;

/**
 * What one file costs in a response BEFORE any diagnostics: its status, gate, `impact`
 * object, empty lists, and — when findings were withheld — the truncation note.
 *
 * Measured, not assumed: a 50-file batch of clean files serializes to 234 bytes per file,
 * and the note adds ~150. Held at 512 because this multiplies by the file count.
 */
export const RESPONSE_ENVELOPE_BYTES_PER_FILE = 512;

/**
 * The whole response bound, stated as arithmetic rather than enforced directly.
 *
 * The allocator bounds DIAGNOSTICS, the only unbounded dimension; the envelope is O(files)
 * and already bounded by the batch file cap. `transport/validate-code.spec.ts` measures the
 * worst legal request against this.
 *
 * Takes the file count rather than importing `MAX_BATCH_FILES`, which lives in
 * `validate/batch-bounds.ts` and already imports this module.
 */
export function maxResponseBytes(fileCount: number): number {
  return MAX_RESPONSE_DIAGNOSTIC_BYTES + fileCount * RESPONSE_ENVELOPE_BYTES_PER_FILE;
}

/** KiB in `bytes`, rounded UP — a partial KiB still costs a full unit of work. */
const kib = (bytes: number): number => Math.ceil(bytes / 1024);

/**
 * How long to wait for a lint that was handed `bytes` of buffer.
 *
 * Never below {@link MIN_LINT_DEADLINE_MS}. Callers do not clamp to
 * {@link MAX_LINT_DEADLINE_MS} — the byte caps do that upstream by refusing the request
 * outright, so the ceiling is enforced where the work is admitted, not where it is timed.
 */
export function lintDeadlineMs(bytes: number): number {
  return Math.max(MIN_LINT_DEADLINE_MS, kib(bytes) * DEADLINE_MS_PER_KIB);
}

/**
 * The most bytes whose {@link lintDeadlineMs} still fits inside `deadlineMs`.
 *
 * The inverse of the function above, floored to a whole KiB so the answer is exact at the
 * boundary — one byte more and the deadline exceeds `deadlineMs`. Used to derive the batch
 * cap from the deadline ceiling instead of from a round multiple of the per-buffer bound.
 */
export function maxBytesWithin(deadlineMs: number): number {
  return Math.floor(deadlineMs / DEADLINE_MS_PER_KIB) * 1024;
}
