/**
 * The per-server context and the request-path deadlines.
 *
 * These live in their own module because they are shared INFRASTRUCTURE, not the
 * property of any one tool. When they sat inside `transport/validate-code.ts` the
 * batch path had to import them from a sibling tool, which meant renaming anything
 * there silently broke the other — a dependency with no reason to exist.
 */
import type { GraphCache } from './graph-cache/graph-cache.js';
import type { Logger } from './logger.js';

/**
 * Per-server context threaded into every handler.
 *
 * NO `appCache` HERE ANY MORE, and its absence is the point. This server used to
 * construct one and thread it through every lint call, because check-node's project
 * model was eager — it parsed every file on every call, so a caller that wanted the work
 * reused had to own the cache and remember to pass it. check-node now keeps ONE lazy
 * `App` per project at process level and reconciles it per call, which is both faster and
 * strictly safer: a cache nobody has to remember to pass is a cache no call path can
 * forget. Do not reintroduce a handle here — see check-node's "Process-level state".
 */
export interface SupervisorContext {
  /** Absolute project root that buffers are validated against. */
  projectDir: string;
  /** Never-stale, background-built project graph — the blast-radius source. */
  graphCache: GraphCache;
  log: Logger;
}

/**
 * Backstop deadline for the lint. Generous ON PURPOSE: it exists to stop a hang,
 * not to enforce a latency budget. A deadline that fires on a legitimately slow
 * call is WORSE than none — the agent gets `not_applicable` and no validation at
 * all, silently, rather than a slightly late answer.
 *
 * NO LONGER A CONSTANT, and no longer defined here: it is a function of how many
 * bytes the request admitted, derived alongside the byte caps in `cost-model.ts`.
 * It lived here as `LINT_DEADLINE_MS = 60_000` while one worst-case buffer was the
 * only input worth sizing against; a batch cap that had to fit inside it — and did
 * not — is what made the relationship worth writing down as arithmetic. Read that
 * module before changing any of it.
 *
 * `lintDeadlineMs(MAX_BUFFER_BYTES)` is still exactly 60 s, so every single-file
 * call behaves as it did.
 *
 * Deliberately NOT re-exported from here. Two import paths for one number is how
 * the caps drifted apart in the first place; `cost-model.js` is the only home.
 */

/**
 * Deadline for the blast radius. Much tighter than the lint's because a graph
 * lookup is ~142 ms measured, and because exceeding it costs only freshness:
 * `impact` already has an `unavailable` state meaning "we don't know".
 *
 * A pathological impact can therefore add at most this to a call, instead of
 * holding it for the lint's full budget.
 */
export const IMPACT_DEADLINE_MS = 2_000;
