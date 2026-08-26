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

/**
 * How many DEPENDANTS one request will lint when computing impact.
 *
 * THE REAL BOUND ON IMPACT, and not a nicety. `IMPACT_DEADLINE_MS` cannot bound this work:
 * a lint is synchronous CPU on the one event loop, so no timer preempts it (see
 * `deadline.ts`). Bounding the INPUT is the only defence, exactly as `MAX_BUFFER_BYTES` is
 * for the primary lint.
 *
 * DERIVED from the deadline it has to fit inside, on the worst project scale:
 *
 *   impact deadline                                     2 000 ms
 *   less the project read at 10k files                  ~ 850 ms
 *   leaves for both lint passes                         ~1 150 ms
 *
 * Measured twice-lint cost, and the same {@link LOAD_FACTOR} the lint deadline uses:
 *
 *   100 dependants   258 ms idle    774 ms loaded   -> 1 624 ms total, FITS
 *   200 dependants   487 ms idle  1 460 ms loaded   -> over
 *   311 dependants   716 ms idle  2 147 ms loaded   -> over on its own
 *
 * 311 is not hypothetical: it is the most-depended-on file measured on a real 2 615-file
 * application (`lib/current_profile`). The same measurement puts 99.37% of targets at 100
 * dependants or fewer — p50 1, p90 4, p99 59 — so the bound is hit rarely and, when it is,
 * IT IS REPORTED (`unchecked_dependants`) rather than silently shortening the analysis.
 */
export const MAX_DEPENDANTS_LINTED = 100;

/**
 * Cost of DISCOVERING dependants, per KiB of candidate text.
 *
 * Discovery parses every file whose text contains the target's name and resolves its
 * references through the graph, so it scales with the BYTES it must parse rather than with
 * the file count. Measured on a real 2 615-file application across four very differently
 * shaped targets: 12.82, 12.52, 8.59 and 14.60 ms/KiB. Held above the slowest observed, for
 * the same reason {@link LINT_MS_PER_KIB} is.
 */
export const DISCOVERY_MS_PER_KIB = 15;

/**
 * How much candidate text one target's discovery will parse before giving up.
 *
 * WHY A BOUND AT ALL, and why it is not {@link MAX_DEPENDANTS_LINTED}: that one bounds the
 * two lint passes, which happen AFTER discovery. Discovery itself was unbounded, and the
 * most-referenced file on a real application (`lib/current_profile`, 312 candidates) cost
 * 4.7 s and then returned `unavailable` anyway — seconds spent to reach "I do not know".
 * The candidate byte total is known from a substring scan, before a single parse, so the
 * same answer costs milliseconds instead.
 *
 * DERIVED from what has to fit inside `IMPACT_DEADLINE_MS`:
 *
 *   impact deadline                                    2 000 ms
 *   less the project read                              ~ 235 ms
 *   less both lint passes at the dependant bound       ~ 258 ms
 *   leaves for discovery                              ~1 507 ms
 *   at {@link DISCOVERY_MS_PER_KIB}                     ~100 KiB
 *
 * Held at 64 KiB rather than 100, because 100 spends the entire remaining budget and leaves
 * nothing for a larger project's read. Measured against the same application: candidate text
 * is p50 1 KiB, p90 13, p95 23, p99 143 — so 64 KiB is nearly 3x the p95 and turns away
 * 2.51% of targets, each in a few milliseconds instead of several seconds.
 */
export const MAX_CANDIDATE_BYTES = 64 * 1024;
