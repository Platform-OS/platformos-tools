/**
 * A deadline wrapper for the request path.
 *
 * WHAT THIS DOES AND DOES NOT BUY. The lint cannot be interrupted mid-flight: parsing is
 * synchronous CPU work on the one event loop, so no timer preempts it. Racing a deadline
 * returns control to the CALLER while the work runs on to completion. That fixes the
 * failure mode that hurts — the agent stops waiting — but it is a BACKSTOP, not the primary
 * defence, which is bounding the input (`MAX_BUFFER_BYTES`). True cancellation would need
 * the lint on a worker thread.
 */

/**
 * Returned instead of a value when the deadline expires. A unique symbol rather
 * than `undefined`/`null` so it can never collide with a legitimate result.
 */
export const TIMED_OUT = Symbol('platformos-supervisor:timed-out');

export type TimedOut = typeof TIMED_OUT;

/**
 * Resolve with `work`'s value, or with {@link TIMED_OUT} once `ms` elapses.
 *
 * The timer is cleared on BOTH outcomes, and `unref`'d besides, so a pending deadline can
 * never hold the process open.
 *
 * A rejection from `work` propagates unchanged. NOTE that when the deadline wins, `work` is
 * left running and unobserved — the caller MUST attach a handler to it, or a later
 * rejection becomes an unhandled rejection.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | TimedOut> {
  return new Promise<T | TimedOut>((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    // Node-only: `unref` keeps a pending deadline from holding the event loop.
    timer.unref?.();

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
