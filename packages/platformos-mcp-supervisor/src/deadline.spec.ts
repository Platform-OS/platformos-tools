import { describe, expect, it, vi } from 'vitest';

import { TIMED_OUT, withDeadline } from './deadline.js';

/**
 * `withDeadline` is a backstop, and its contract is narrow on purpose:
 * add a deadline, change nothing else. In particular a rejection must pass through
 * untouched, because the lint is the primary gate and swallowing its failure would
 * turn a real error into a silent pass.
 */
const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const rejectAfter = (ms: number, error: Error) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(error), ms));

describe('Unit: withDeadline', () => {
  it('resolves with the value when the work finishes first', async () => {
    await expect(withDeadline(after(1, 'done'), 1_000)).resolves.toEqual('done');
  });

  it('resolves with TIMED_OUT when the deadline wins', async () => {
    await expect(withDeadline(after(1_000, 'too late'), 5)).resolves.toBe(TIMED_OUT);
  });

  it('resolves with TIMED_OUT for work that never settles at all', async () => {
    // The exact shape that used to hang the tool for the life of the session.
    await expect(withDeadline(new Promise<string>(() => {}), 5)).resolves.toBe(TIMED_OUT);
  });

  it('propagates a rejection unchanged rather than converting it to TIMED_OUT', async () => {
    // The lint is the primary gate: a genuine failure must stay a failure.
    const failure = new Error('lint exploded');

    await expect(withDeadline(rejectAfter(1, failure), 1_000)).rejects.toThrow(failure);
  });

  it('preserves a falsy result, which a null/undefined sentinel would have destroyed', async () => {
    // TIMED_OUT is a unique Symbol precisely so these stay distinguishable.
    await expect(withDeadline(Promise.resolve(undefined), 1_000)).resolves.toBeUndefined();
    await expect(withDeadline(Promise.resolve(null), 1_000)).resolves.toBeNull();
    await expect(withDeadline(Promise.resolve(0), 1_000)).resolves.toEqual(0);
    await expect(withDeadline(Promise.resolve([]), 1_000)).resolves.toEqual([]);
  });

  it('clears the timer when the work wins, so nothing is left pending', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await withDeadline(after(1, 'done'), 60_000);

      // A 60 s timer left armed would hold a stdio server open past its work.
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('clears the timer when the work REJECTS, not only when it resolves', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await expect(withDeadline(rejectAfter(1, new Error('x')), 60_000)).rejects.toThrow();

      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('unrefs the deadline timer so a pending one cannot hold the process open', async () => {
    const unref = vi.fn();
    const setSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => ({ unref }) as unknown as ReturnType<typeof setTimeout>) as never);
    try {
      void withDeadline(Promise.resolve('immediate'), 60_000);

      expect(unref).toHaveBeenCalledOnce();
    } finally {
      setSpy.mockRestore();
    }
  });

  it('does not stop the abandoned work from continuing — the documented limitation', async () => {
    // Parsing is synchronous CPU work; nothing here can preempt it. The deadline
    // frees the CALLER, it does not cancel. Pinned so the limitation is not
    // mistaken for a bug later, and so nobody assumes cancellation they don't have.
    let finished = false;
    const work = after(30, 'eventually').then((value) => {
      finished = true;
      return value;
    });

    expect(await withDeadline(work, 5)).toBe(TIMED_OUT);
    expect(finished).toBe(false);

    await work;
    expect(finished).toBe(true);
  });
});
