import { describe, expect, it, vi } from 'vitest';

import { createBoundedCache } from './bounded-cache';

describe('Unit: createBoundedCache', () => {
  it('computes once per key and serves the cached result afterwards', () => {
    const cache = createBoundedCache<string>(10);
    const compute = vi.fn(() => 'value');

    expect([cache('a', compute), cache('a', compute), cache('a', compute)]).toEqual([
      'value',
      'value',
      'value',
    ]);
    expect(compute).toHaveBeenCalledOnce();
  });

  it('treats falsy results as hits rather than recomputing them', () => {
    const cache = createBoundedCache<undefined>(10);
    const compute = vi.fn(() => undefined);

    expect([cache('a', compute), cache('a', compute)]).toEqual([undefined, undefined]);
    expect(compute).toHaveBeenCalledOnce();
  });

  it('keeps distinct keys apart', () => {
    const cache = createBoundedCache<string>(10);

    expect([cache('a', () => 'A'), cache('b', () => 'B'), cache('a', () => 'ignored')]).toEqual([
      'A',
      'B',
      'A',
    ]);
  });

  it('evicts the oldest entry once the limit is exceeded, keeping the newer ones', () => {
    const cache = createBoundedCache<string>(2);
    const recomputeA = vi.fn(() => 'A2');

    cache('a', () => 'A');
    cache('b', () => 'B');
    cache('c', () => 'C');

    // Reading a hit does not insert, so these two cannot themselves evict.
    expect([cache('b', () => 'ignored'), cache('c', () => 'ignored')]).toEqual(['B', 'C']);
    // 'a' was the oldest when the limit was exceeded, so it is the one that went.
    expect(cache('a', recomputeA)).toEqual('A2');
    expect(recomputeA).toHaveBeenCalledOnce();
  });
});
