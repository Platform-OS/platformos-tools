/**
 * What a lint COSTS — and therefore how much work one request may admit, and how
 * long the server waits for it.
 *
 * WHY THIS MODULE EXISTS. Three numbers used to be chosen independently:
 *
 *   MAX_BUFFER_BYTES  128 KiB   measured against the lint
 *   MAX_BATCH_BYTES   4 x that  a round multiple, chosen for tidiness
 *   LINT_DEADLINE_MS  60 s      measured against ONE worst-case buffer
 *
 * Only the first and third were ever related to each other, and nothing recorded
 * that relationship anywhere a reader could check it. So when `FilterArity` was
 * added — a check that walks every `LiquidFilter`, moving throughput from ~55 to
 * ~75 ms/KiB — the per-buffer bound stayed inside the deadline and the BATCH bound
 * silently crossed it. Measured: the worst legal batch went from 27.9 s to 37.8 s
 * idle, which at the load factor below is 60-113 s against a 60 s deadline.
 *
 * That failure is quiet and fails in the expensive direction. A batch past the
 * deadline returns `not_applicable: timed_out` for EVERY file in the request, so a
 * large-but-legal changeset gets no validation at all, exactly when being wrong
 * costs the most. Nothing in the type system, and nothing in a test, connected the
 * cap to the deadline it had to fit inside.
 *
 * So the relationship is written down here, once, as arithmetic — and both bounds
 * are derived from it rather than chosen. Adding per-node work now moves
 * {@link LINT_MS_PER_KIB} and every dependent bound follows; the accompanying spec
 * fails if any of them stops fitting.
 *
 * WHY THE DEADLINE SCALES WITH THE REQUEST, rather than staying a constant. It is
 * forced, not preferred. Hold the deadline at 60 s and invert the arithmetic below
 * and the largest admissible batch is ~133 KiB — SMALLER than one legal buffer, so
 * a one-file batch at `MAX_BUFFER_BYTES` would be refused for being too large. A
 * fixed deadline and a meaningful batch cap cannot both exist. Scaling also costs
 * almost nothing: this deadline is a backstop for ASYNC stalls (see `deadline.ts`
 * — it cannot fire during a synchronous parse at all), and a request that admitted
 * more work has to be allowed to take longer for the same reason it was admitted.
 *
 * Every number here is MEASURED, and the measurement is named. A plausible constant
 * is how this file rots back into three unrelated magic numbers.
 */

/**
 * Wall-clock cost of linting one KiB of buffer, on an idle machine, warm cache.
 *
 * Measured end to end (`lintBuffer` against a real 162-file project), not against
 * the parse alone — every enabled check walks the AST after it:
 *
 *   ```
 *     128 KiB single buffer   ->  7.1 s   (~55 ms/KiB)
 *     508 KiB, 4-file batch   -> 37.8 s   (~74 ms/KiB)
 *   ```
 *
 * Rounded UP to the worse of the two. The batch figure is the honest one to build
 * on: it is the most recent, it includes the per-node work `FilterArity` added, and
 * it is mildly superlinear, so sizing on the single-buffer rate would under-count
 * exactly the case these bounds exist to contain.
 *
 * DO NOT LOWER THIS TO MATCH A FASTER MEASUREMENT. It varies by several times with
 * the project and the markup, and it is deliberately set at the SLOWEST observed
 * rate. A separate run of the derived cap against a 21-file project came in at
 * 12-17 ms/KiB across every legal batch shape (4, 8 and 50 files, and two maximal
 * buffers) — four to six times faster than the figure above, and no reason to move
 * it. Cost tracks parse and check work, not bytes: 127 KiB of one repeated
 * character validates roughly 3x faster than 127 KiB of real markup, and a project
 * with more files to resolve references against is slower again. Being wrong FAST
 * here costs a longer wait before a stall is declared; being wrong SLOW admits a
 * request that cannot finish, which returns `timed_out` for every file in it.
 */
export const LINT_MS_PER_KIB = 75;

/**
 * How much slower the same lint runs on a contended machine than on an idle one.
 *
 * Measured at ~2.3x (128 KiB: ~10 s idle, ~23 s under load). Held at 3 because it
 * is an upper bound on someone else's machine, which is not ours to observe, and
 * because being wrong low here produces a false `timed_out` — a silent no-answer —
 * while being wrong high costs only a longer wait before declaring a stall.
 */
export const LOAD_FACTOR = 3;

/**
 * How far beyond the expected loaded worst case the deadline sits.
 *
 * The deadline must never fire on work that was legal to admit; it exists to catch
 * a stall. 2x is the margin the existing 60 s deadline already carried over one
 * worst-case buffer (128 KiB: ~23 s loaded), so this preserves a calibration that
 * has held rather than inventing a new one.
 */
export const DEADLINE_MARGIN = 2;

/** Deadline granted per KiB of admitted work: idle cost, under load, with margin. */
export const DEADLINE_MS_PER_KIB = LINT_MS_PER_KIB * LOAD_FACTOR * DEADLINE_MARGIN;

/**
 * Deadline floor, applied to every request however small.
 *
 * Small requests are not dominated by their buffers: a cold first call also builds
 * the app, loads the config and reconciles the graph (~0.8 s idle, ~1.6 s loaded on
 * a 162-file project — and larger projects exist). The floor covers that fixed cost
 * with room to spare, and it is what keeps the single-file path — every call below
 * 133 KiB, which is every call in practice — behaving exactly as it did before the
 * deadline began to scale.
 */
export const MIN_LINT_DEADLINE_MS = 60_000;

/**
 * Deadline ceiling, and therefore the real origin of {@link maxBytesWithin}'s
 * answer for the batch cap.
 *
 * This is the one POLICY number here rather than a measured one: how long the
 * server is willing to hold a request open before concluding it has stalled. Two
 * minutes is past the point where an agent has any use for the answer, so nothing
 * is gained by waiting longer — and every extra second of ceiling buys a larger
 * admissible batch, which is work a stalled request would then be holding.
 */
export const MAX_LINT_DEADLINE_MS = 120_000;

/**
 * How much of the AGENT'S CONTEXT one `validate_code` answer may spend.
 *
 * The only POLICY number in this file besides {@link MAX_LINT_DEADLINE_MS}, and the
 * one bound here that is not about the server's own work at all. Every dimension of
 * a REQUEST is bounded — buffer bytes, batch files, batch bytes, and the deadline
 * derived from them. The RESPONSE was bounded by nothing, and measured at roughly
 * SIX TIMES the size of the input that produced it:
 *
 *   ```
 *     128 KiB single buffer, all broken   4 228 diagnostics    634 KiB   ~162 000 tokens
 *     266 KiB batch, all broken           8 784 diagnostics  1 313 KiB   ~336 000 tokens
 *   ```
 *
 * A single legal call could return more tokens than most context windows hold, with
 * no error and nothing in the payload saying anything unusual had happened. The
 * transport is not the limit — a 1.28 MiB JSON-RPC frame was measured arriving
 * intact — so this is a deliberate judgement about spend, not a technical ceiling.
 *
 * 8 000 tokens is a few percent of a typical window. It is chosen against the
 * MEASURED shape of real calls rather than the pathological ones: across the 21
 * files of the evaluation substrate the median answer is ~45 tokens, the worst is
 * ~122, and a realistic broken edit costs ~219. At ~153 bytes per diagnostic this
 * budget holds roughly 200 findings, so every measured real case is three orders of
 * magnitude below the cap and cannot be touched by it. What the cap defends against
 * is the tail: one generated or minified file, or one cascading syntax error in a
 * large partial, quietly consuming most of an agent's working context.
 */
export const RESPONSE_TOKEN_BUDGET = 8_000;

/**
 * Bytes per token, for converting the budget above into something countable.
 *
 * An ESTIMATE and deliberately a crude one — this JSON is mostly ASCII prose and
 * punctuation, where ~4 bytes/token is the usual rule of thumb. The exact tokenizer
 * is the client's and not ours to know, so the honest move is to state the
 * assumption here rather than imply a precision the number does not have. Being
 * wrong by 25% moves the cap between ~150 and ~250 diagnostics, which changes
 * nothing about which calls it affects.
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
 * What one file costs in a response BEFORE any diagnostics: its status, gate,
 * `impact` object, empty lists, and — when findings were withheld — the truncation
 * note.
 *
 * Measured, not assumed: a 50-file batch of clean files serializes to 11.4 KiB, or
 * 234 bytes per file, and the note adds ~150. Held at 512 because this multiplies by
 * the file count and the fields it covers are the ones most likely to GROW — the
 * TASK-8 work reintroduces `hint`, `domain_guide` and friends, and a per-file
 * envelope that quietly doubles would break the bound below without touching the
 * allocator that enforces it.
 */
export const RESPONSE_ENVELOPE_BYTES_PER_FILE = 512;

/**
 * The whole response bound, stated as arithmetic rather than enforced directly.
 *
 * The allocator bounds DIAGNOSTICS, which is the only unbounded dimension; the
 * envelope is O(files) and already bounded by the batch file cap. Multiplying the two
 * out is what turns "the big list is capped" into a number a reader can check, and
 * `validate/response-bound.spec.ts` measures the worst legal request against it.
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
 * {@link MAX_LINT_DEADLINE_MS} — the byte caps do that, upstream, by refusing the
 * request outright. A deadline silently smaller than the work it is timing is the
 * exact defect this module exists to prevent, so the ceiling is enforced where the
 * work is admitted, not where it is timed.
 */
export function lintDeadlineMs(bytes: number): number {
  return Math.max(MIN_LINT_DEADLINE_MS, kib(bytes) * DEADLINE_MS_PER_KIB);
}

/**
 * The most bytes whose {@link lintDeadlineMs} still fits inside `deadlineMs`.
 *
 * The inverse of the function above, floored to a whole KiB so the answer is exact
 * at the boundary — one byte more and the deadline exceeds `deadlineMs`. Used to
 * derive the batch cap from the deadline ceiling instead of picking a round
 * multiple of the per-buffer bound, which is what drifted.
 */
export function maxBytesWithin(deadlineMs: number): number {
  return Math.floor(deadlineMs / DEADLINE_MS_PER_KIB) * 1024;
}
