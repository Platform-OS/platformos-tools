/**
 * Process lifetime guards: signals and last-resort error handlers.
 *
 * The supervisor is a long-lived stdio process an agent holds open for a whole session, and
 * under Node's default an unhandled rejection is FATAL — from the agent's side the tool
 * simply stops existing mid-session, with nothing in the JSON-RPC stream to explain it.
 *
 * THE SPLIT is deliberately not symmetric:
 *
 *   - `unhandledRejection` — LOG AND KEEP SERVING. A rejected background promise does not
 *     imply the server's state is corrupt, and staying up beats vanishing.
 *   - `uncaughtException` — LOG, SHUT DOWN, EXIT NON-ZERO. The process state may genuinely
 *     be corrupt, so continuing to answer would risk returning wrong diagnostics.
 *
 * HARD CONSTRAINT: stdout belongs to the MCP JSON-RPC stream. Everything here logs through
 * the injected {@link Logger}, which writes to stderr; a stray stdout write would corrupt
 * the protocol.
 *
 * `exit` and `emitter` are injected so the handlers can be driven in a test without
 * terminating the runner. The returned uninstall function is wired into `shutdown` so a
 * start/stop/start cycle does not accumulate listeners.
 */
import type { Logger } from '../logger.js';

/** The subset of `process` these guards touch. Narrow, so a test can pass a stub. */
export interface GuardEmitter {
  on(event: string, listener: (...args: never[]) => void): unknown;
  once(event: string, listener: (...args: never[]) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

export interface ProcessGuardOptions {
  log: Logger;
  /** The server's idempotent teardown. Awaited before a fatal exit. */
  shutdown: (reason?: string) => Promise<void>;
  /** Defaults to `process.exit`. Injected so tests never terminate the runner. */
  exit?: (code: number) => void;
  /** Defaults to `process`. Injected so tests can observe registration. */
  emitter?: GuardEmitter;
}

/** Signals that mean "stop cleanly"; both exit 0. */
const TERMINATION_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Render a thrown/rejected value for the log.
 *
 * A rejection reason is NOT necessarily an Error — `Promise.reject('nope')` and
 * `Promise.reject()` are both legal — so this never assumes `.stack` exists.
 */
function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  // `String(Symbol())` throws; `String(undefined)` does not. Be total.
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Install signal handlers and last-resort error guards. Returns an uninstall
 * function; calling it twice is harmless.
 */
export function installProcessGuards(options: ProcessGuardOptions): () => void {
  const { log, shutdown } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const emitter = options.emitter ?? (process as unknown as GuardEmitter);

  const registered: Array<{ event: string; listener: (...args: never[]) => void }> = [];

  const onSignal = (signal: string) => () => {
    void shutdown(signal).finally(() => exit(0));
  };

  // `once`: a second SIGINT while shutting down should not re-enter teardown.
  for (const signal of TERMINATION_SIGNALS) {
    const listener = onSignal(signal) as (...args: never[]) => void;
    emitter.once(signal, listener);
    registered.push({ event: signal, listener });
  }

  // `on`, not `once`: unhandled rejections are survivable and may recur, and each one must
  // be reported.
  const onUnhandledRejection = ((reason: unknown) => {
    log(
      `unhandled promise rejection (server continues): ${describe(reason)}. ` +
        `This is a bug — a background task rejected with nobody awaiting it.`,
    );
  }) as (...args: never[]) => void;
  emitter.on('unhandledRejection', onUnhandledRejection);
  registered.push({ event: 'unhandledRejection', listener: onUnhandledRejection });

  const onUncaughtException = ((error: unknown) => {
    log(`uncaught exception, shutting down: ${describe(error)}`);
    // Non-zero: a supervisor that died must not look like a clean exit to whatever
    // supervises IT. `finally` so a failing shutdown still exits.
    void shutdown('uncaught exception').finally(() => exit(1));
  }) as (...args: never[]) => void;
  emitter.on('uncaughtException', onUncaughtException);
  registered.push({ event: 'uncaughtException', listener: onUncaughtException });

  let uninstalled = false;
  return () => {
    if (uninstalled) return;
    uninstalled = true;
    for (const { event, listener } of registered) emitter.removeListener(event, listener);
  };
}
