import { describe, expect, it } from 'vitest';

import {
  DEADLINE_MARGIN,
  DEADLINE_MS_PER_KIB,
  LINT_MS_PER_KIB,
  LOAD_FACTOR,
  MAX_LINT_DEADLINE_MS,
  MIN_LINT_DEADLINE_MS,
  lintDeadlineMs,
  maxBytesWithin,
} from './cost-model.js';
import { MAX_BUFFER_BYTES } from './adapter-input.js';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from './validate/batch-bounds.js';

/**
 * The arithmetic, and the invariants that make it safe.
 */
describe('Unit: the lint cost model', () => {
  it('composes the per-KiB deadline from its three named factors', () => {
    // Pinned as a composition, not as 450: a reader who changes LOAD_FACTOR should
    // see this follow, and a reader who changes this alone should see it break.
    expect([LINT_MS_PER_KIB, LOAD_FACTOR, DEADLINE_MARGIN, DEADLINE_MS_PER_KIB]).toEqual([
      75,
      3,
      2,
      75 * 3 * 2,
    ]);
  });

  it('charges a partial KiB as a whole one', () => {
    // Rounding DOWN would grant a deadline smaller than the work admitted, which is
    // the failure this module exists to prevent — so the rounding direction is part
    // of the contract, not an implementation detail.
    expect([lintDeadlineMs(300 * 1024), lintDeadlineMs(300 * 1024 - 1023)]).toEqual([
      300 * DEADLINE_MS_PER_KIB,
      300 * DEADLINE_MS_PER_KIB,
    ]);
  });

  it('never returns less than the floor, however small the request', () => {
    expect([lintDeadlineMs(0), lintDeadlineMs(1), lintDeadlineMs(1024)]).toEqual([
      MIN_LINT_DEADLINE_MS,
      MIN_LINT_DEADLINE_MS,
      MIN_LINT_DEADLINE_MS,
    ]);
  });

  it('inverts exactly: one KiB more than maxBytesWithin overshoots the deadline', () => {
    const bytes = maxBytesWithin(MAX_LINT_DEADLINE_MS);

    expect([lintDeadlineMs(bytes) <= MAX_LINT_DEADLINE_MS, lintDeadlineMs(bytes + 1024)]).toEqual([
      true,
      lintDeadlineMs(bytes) + DEADLINE_MS_PER_KIB,
    ]);
  });
});

describe('Unit: the bounds derived from the cost model', () => {
  it('admits the worst legal BATCH inside the deadline that batch is granted', () => {
    // The regression, stated directly. Before this derivation MAX_BATCH_BYTES was
    // 512 KiB against a fixed 60 s deadline: 512 KiB of measured work is ~38 s idle
    // and ~115 s loaded, so the worst legal batch could not finish in time and every
    // file in it returned `timed_out`.
    expect(lintDeadlineMs(MAX_BATCH_BYTES) <= MAX_LINT_DEADLINE_MS).toBe(true);
  });

  it('admits the worst legal single BUFFER inside the deadline it is granted', () => {
    expect(lintDeadlineMs(MAX_BUFFER_BYTES) <= MAX_LINT_DEADLINE_MS).toBe(true);
  });

  it('leaves the single-file path on exactly the deadline it had before scaling', () => {
    // Every real single-file call is far below MAX_BUFFER_BYTES, and even a maximal
    // one lands on the floor. Scaling the deadline therefore changed nothing about
    // the path that carries essentially all traffic — which is why it was safe to
    // introduce. If this ever fails, single-file latency behaviour has moved and the
    // 60 s figure quoted in `context.ts` and in the timeout message is stale.
    expect(lintDeadlineMs(MAX_BUFFER_BYTES)).toEqual(MIN_LINT_DEADLINE_MS);
  });

  it('never refuses a batch for being smaller than one legal single buffer', () => {
    // A batch cap below the per-buffer cap would refuse a one-file batch containing
    // a file the single-file form accepts — the same content, refused for the shape
    // of the request. This is also what forces the deadline to scale: at a fixed
    // 60 s the derived batch cap is ~133 KiB, and this invariant fails.
    expect(MAX_BATCH_BYTES > MAX_BUFFER_BYTES).toBe(true);
  });

  it('states the derived cap, so a change to the model shows up as a number', () => {
    expect([MAX_BATCH_BYTES, MAX_BATCH_BYTES / 1024, MAX_BATCH_FILES]).toEqual([272_384, 266, 50]);
  });

  it('bounds the whole request even at the file-count cap', () => {
    // MAX_BATCH_FILES alone cannot bound the work: 50 files just under the buffer
    // cap would be ~6 MiB. The byte cap is what binds, and it binds well before the
    // file cap does — this records which of the two is load-bearing.
    expect(MAX_BATCH_FILES * MAX_BUFFER_BYTES > MAX_BATCH_BYTES).toBe(true);
  });
});
