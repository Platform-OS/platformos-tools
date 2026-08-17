import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { installProcessGuards, type GuardEmitter } from './process-guards.js';

/**
 * Under Node's default an unhandled rejection is FATAL, so one rejected
 * promise on a background path used to take the whole stdio server down — the
 * agent losing the tool mid-session with nothing in the JSON-RPC stream to explain
 * it. These pin the asymmetry that makes the guards correct:
 */
const harness = () => {
  const logs: string[] = [];
  const exits: number[] = [];
  const shutdowns: (string | undefined)[] = [];
  const emitter = new EventEmitter();

  const uninstall = installProcessGuards({
    log: (message) => logs.push(message),
    shutdown: async (reason) => {
      shutdowns.push(reason);
    },
    exit: (code) => exits.push(code),
    emitter: emitter as unknown as GuardEmitter,
  });

  return { logs, exits, shutdowns, emitter, uninstall };
};

/** The handlers finish their work in a `.finally`, so yield the microtask queue. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Unit: installProcessGuards — unhandled rejections are survivable', () => {
  it('logs an Error rejection WITH its stack and does not exit', async () => {
    const { logs, exits, shutdowns, emitter } = harness();
    const error = new Error('background task failed');

    emitter.emit('unhandledRejection', error);
    await settle();

    expect(logs).toHaveLength(1);
    // The stack is what makes this diagnosable at all — the whole point of not
    // just dying silently.
    expect(logs[0]).toContain(error.stack!);
    expect(logs[0]).toContain('server continues');
    // Survivable: no teardown, no exit.
    expect(exits).toEqual([]);
    expect(shutdowns).toEqual([]);
  });

  it('reports EVERY rejection, not just the first', async () => {
    // Registered with `on`, not `once`: a `once` here would silence every
    // rejection after the first, which is the opposite of the intent.
    const { logs, emitter } = harness();

    emitter.emit('unhandledRejection', new Error('first'));
    emitter.emit('unhandledRejection', new Error('second'));
    emitter.emit('unhandledRejection', new Error('third'));
    await settle();

    expect(logs).toHaveLength(3);
  });

  it.each([
    ['a string', 'plain string reason', 'plain string reason'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a number', 42, '42'],
    ['a plain object', { code: 'E' }, '[object Object]'],
  ])('survives a non-Error rejection value: %s', async (_label, reason, rendered) => {
    // `Promise.reject('nope')` and `Promise.reject()` are both legal, so the guard
    // must never assume `.stack`. A guard that throws while reporting a failure is
    // worse than no guard.
    const { logs, exits, emitter } = harness();

    expect(() => emitter.emit('unhandledRejection', reason)).not.toThrow();
    await settle();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(rendered);
    expect(exits).toEqual([]);
  });

  it('survives a Symbol reason, which `String()` refuses to render', async () => {
    // `String(Symbol())` THROWS. The renderer falls back rather than letting the
    // guard become the crash.
    const { logs, exits, emitter } = harness();

    expect(() => emitter.emit('unhandledRejection', Symbol('nope'))).not.toThrow();
    await settle();

    expect(logs).toHaveLength(1);
    expect(exits).toEqual([]);
  });
});

describe('Unit: installProcessGuards — an uncaught exception is fatal', () => {
  it('logs, shuts down gracefully, and exits NON-ZERO', async () => {
    const { logs, exits, shutdowns, emitter } = harness();
    const error = new Error('invariant broken');

    emitter.emit('uncaughtException', error);
    await settle();

    expect(logs).toEqual([`uncaught exception, shutting down: ${error.stack}`]);
    // Through the ordinary teardown, so a graph build in flight is still reaped.
    expect(shutdowns).toEqual(['uncaught exception']);
    // Non-zero: a supervisor that died must not look like a clean exit to whatever
    // supervises IT.
    expect(exits).toEqual([1]);
  });

  it('still exits when shutdown itself fails', async () => {
    // The process state has already been declared unsound; a failing teardown must
    // not wedge it open.
    const logs: string[] = [];
    const exits: number[] = [];
    const emitter = new EventEmitter();
    installProcessGuards({
      log: (m) => logs.push(m),
      shutdown: async () => {
        throw new Error('teardown exploded');
      },
      exit: (code) => exits.push(code),
      emitter: emitter as unknown as GuardEmitter,
    });

    emitter.emit('uncaughtException', new Error('boom'));
    await settle();

    expect(exits).toEqual([1]);
  });
});

describe('Unit: installProcessGuards — termination signals', () => {
  it.each(['SIGINT', 'SIGTERM'])('%s shuts down and exits ZERO', async (signal) => {
    const { exits, shutdowns, emitter } = harness();

    emitter.emit(signal);
    await settle();

    expect(shutdowns).toEqual([signal]);
    // Zero: an operator asking us to stop is not a failure.
    expect(exits).toEqual([0]);
  });

  it('handles a signal only once, so a second SIGINT does not re-enter teardown', async () => {
    const { shutdowns, emitter } = harness();

    emitter.emit('SIGINT');
    emitter.emit('SIGINT');
    await settle();

    expect(shutdowns).toEqual(['SIGINT']);
  });
});

describe('Unit: installProcessGuards — registration hygiene', () => {
  it('registers exactly one listener per event', () => {
    const emitter = new EventEmitter();

    installProcessGuards({
      log: () => {},
      shutdown: async () => {},
      exit: () => {},
      emitter: emitter as unknown as GuardEmitter,
    });

    expect(
      ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'].map((event) =>
        emitter.listenerCount(event),
      ),
    ).toEqual([1, 1, 1, 1]);
  });

  it('uninstall removes every listener, so start/stop/start does not accumulate', () => {
    const emitter = new EventEmitter();
    const install = () =>
      installProcessGuards({
        log: () => {},
        shutdown: async () => {},
        exit: () => {},
        emitter: emitter as unknown as GuardEmitter,
      });

    const first = install();
    first();

    // Second lifecycle: counts must be back to one each, not two.
    const second = install();
    expect(
      ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'].map((event) =>
        emitter.listenerCount(event),
      ),
    ).toEqual([1, 1, 1, 1]);

    second();
    expect(
      ['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'].map((event) =>
        emitter.listenerCount(event),
      ),
    ).toEqual([0, 0, 0, 0]);
  });

  it('uninstall is idempotent', () => {
    const emitter = new EventEmitter();
    const uninstall = installProcessGuards({
      log: () => {},
      shutdown: async () => {},
      exit: () => {},
      emitter: emitter as unknown as GuardEmitter,
    });

    uninstall();
    expect(() => uninstall()).not.toThrow();
    expect(emitter.listenerCount('unhandledRejection')).toEqual(0);
  });

  it('an uninstalled guard no longer reacts', async () => {
    const { logs, exits, emitter, uninstall } = harness();

    uninstall();
    emitter.emit('unhandledRejection', new Error('ignored'));
    emitter.emit('uncaughtException', new Error('ignored'));
    await settle();

    expect([logs, exits]).toEqual([[], []]);
  });
});

describe('Unit: installProcessGuards — stdout is never touched', () => {
  it('logs only through the injected logger, never to the JSON-RPC stream', async () => {
    // stdout belongs to MCP JSON-RPC. A stray write there corrupts the protocol,
    // which is a WORSE failure than the crash being handled.
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const { logs, emitter } = harness();

      emitter.emit('unhandledRejection', new Error('noisy'));
      emitter.emit('uncaughtException', new Error('fatal'));
      await settle();

      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(logs).toHaveLength(2);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});
