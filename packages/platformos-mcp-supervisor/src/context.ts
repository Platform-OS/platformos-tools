/**
 * The per-server context and the request-path deadlines.
 *
 * These live in their own module because they are shared INFRASTRUCTURE, not the
 * property of any one tool. When they sat inside `transport/validate-code.ts` the
 * batch path had to import them from a sibling tool, which meant renaming anything
 * there silently broke the other — a dependency with no reason to exist.
 */
import type { AppCache } from '@platformos/platformos-check-node';

import type { GraphCache } from './graph-cache/graph-cache.js';
import type { Logger } from './logger.js';

/** Per-server context threaded into every handler. */
export interface SupervisorContext {
  /** Absolute project root that buffers are validated against. */
  projectDir: string;
  /** Never-stale, background-built project graph — the blast-radius source. */
  graphCache: GraphCache;
  /** Never-stale parsed-project cache — reused across lint calls so the project isn't re-parsed each time. */
  appCache: AppCache;
  log: Logger;
}

/**
 * Backstop deadline for the lint. Generous ON PURPOSE: it exists to stop a hang,
 * not to enforce a latency budget. A deadline that fires on a legitimately slow
 * call is WORSE than none — the agent gets `not_applicable` and no validation at
 * all, silently, rather than a slightly late answer.
 *
 * Sized against measurement of the worst LEGAL input, on an idle box and under
 * load, because the second is what sets the real margin:
 *
 *   ```
 *   buffer at MAX_BUFFER_BYTES (128 KiB)   ~10 s idle   ~23 s under load
 *   cold first call, 162-file project      ~0.8 s idle   ~1.6 s under load
 *   ```
 *
 * 30 s left only 1.3x headroom over that loaded worst case, so a legal file on a
 * busy machine could have produced a false `timed_out`. 60 s restores ~2.6x.
 *
 * Raising it costs very little, because this deadline CANNOT fire during a
 * synchronous parse anyway (the event loop is blocked — verified: a 400 KiB buffer
 * returned after 45 s against a 30 s deadline). Its real job is ASYNC stalls — a
 * wedged fs call, a hung graph lookup — and those do not correlate with buffer
 * size, so a higher value trades nothing for removing the false-timeout risk. The
 * `MAX_BUFFER_BYTES` bound, not this, is what keeps CPU-bound work finite.
 */
export const LINT_DEADLINE_MS = 60_000;

/**
 * Deadline for the blast radius. Much tighter than the lint's because a graph
 * lookup is ~142 ms measured, and because exceeding it costs only freshness:
 * `impact` already has an `unavailable` state meaning "we don't know".
 *
 * A pathological impact can therefore add at most this to a call, instead of
 * holding it for the lint's full budget.
 */
export const IMPACT_DEADLINE_MS = 2_000;
