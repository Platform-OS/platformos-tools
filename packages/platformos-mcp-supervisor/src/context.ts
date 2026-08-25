/** The per-server context and the request-path deadlines — shared INFRASTRUCTURE. */
import type { Logger } from './logger.js';

/**
 * Per-server context threaded into every handler.
 *
 * NO CACHE HANDLES HERE, and their absence is the point. check-node keeps ONE lazy `App`
 * per project at process level and reconciles it per call, so a cache nobody has to
 * remember to pass is a cache no call path can forget — do not reintroduce a handle here
 * (see check-node's "Process-level state"). Impact is likewise DERIVED per request from
 * the project's text (`impact/project-scan.ts`), so nothing can be stale.
 */
export interface SupervisorContext {
  /** Absolute project root that buffers are validated against. */
  projectDir: string;
  log: Logger;
  /**
   * Whether cross-file impact runs. OPTIONAL AND DEFAULTING TO ON: impact is a safety
   * feature, so a context that forgets to mention it must get the safe behaviour rather than
   * silently lose the check. Only an explicit `false` — from `--no-impact` or
   * `POS_SUPERVISOR_NO_IMPACT` — turns it off.
   */
  impactEnabled?: boolean;
}

/**
 * Deadline for impact. Much tighter than the lint's, which is a function of admitted bytes
 * and lives in `cost-model.ts` — deliberately not re-exported from here.
 *
 * A BACKSTOP, NOT THE BOUND. A lint is synchronous CPU work and no timer preempts it (see
 * `deadline.ts`), so what actually limits impact is bounded INPUT — `MAX_CANDIDATE_BYTES` and
 * `MAX_DEPENDANTS_LINTED` in `cost-model.ts`, both derived to fit inside this number. This
 * catches what those cannot: a stalled read, or a project large enough that the read alone
 * runs long. Exceeding it costs only the answer, which has an `unavailable` state.
 */
export const IMPACT_DEADLINE_MS = 2_000;
