/** The per-server context and the request-path deadlines — shared INFRASTRUCTURE. */
import type { Logger } from './logger.js';

/**
 * Per-server context threaded into every handler.
 *
 * NO CACHE HANDLES HERE, and their absence is the point. check-node keeps ONE lazy `App`
 * per project at process level and reconciles it per call, so a cache nobody has to
 * remember to pass is a cache no call path can forget — do not reintroduce a handle here
 * (see check-node's "Process-level state"). The blast radius is likewise DERIVED per
 * request from the project's text (`impact/project-scan.ts`), so nothing can be stale.
 */
export interface SupervisorContext {
  /** Absolute project root that buffers are validated against. */
  projectDir: string;
  log: Logger;
}

/**
 * Deadline for the blast radius. Much tighter than the lint's, which is a function of
 * admitted bytes and lives in `cost-model.ts` — deliberately not re-exported from here.
 *
 * Tight because the work is small — one project read (235 ms measured on a 2,615-file
 * project) plus a name filter and a handful of parses, p50 9 ms / p90 63 ms per file — and
 * because exceeding it costs only the answer, which has an `unavailable` state. The tail it
 * exists for is real but rare: the most-referenced partial measured took ~1 s.
 */
export const IMPACT_DEADLINE_MS = 2_000;
