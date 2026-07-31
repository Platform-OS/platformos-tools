/**
 * A keyed cache with a hard entry cap, for memoizing pure functions whose inputs
 * repeat many times within a lint run (e.g. the analysis of a partial that is
 * rendered from dozens of call sites).
 *
 * Eviction is least-recently-used: a hit moves its entry to the back of the
 * queue, so a working set that fits under the cap survives no matter how much
 * one-off traffic flows past it. Plain insertion order would evict the
 * frequently-rendered partials first — exactly the entries the cache exists for —
 * as soon as a project pushed past `limit` distinct keys.
 *
 * Callers are expected to key on the exact input the result depends on
 * (typically file content), so an entry can never be stale: changed content is a
 * different key, and the old entry ages out.
 *
 * `clear()` drops everything. Long-lived hosts (language server, MCP supervisor)
 * use it to release a project's entries when they switch projects; tests use it
 * to stay independent of each other.
 */
export interface BoundedCache<Result> {
  (key: string, compute: () => Result): Result;
  clear(): void;
}

export function createBoundedCache<Result>(limit: number): BoundedCache<Result> {
  const entries = new Map<string, Result>();

  const cached = function cached(key: string, compute: () => Result): Result {
    // `has` rather than a truthiness check: `undefined`/`null`/`false` are
    // legitimate cached results and must count as hits.
    if (entries.has(key)) {
      const hit = entries.get(key)!;
      // Re-insert so this key becomes the most recently used one.
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }

    const result = compute();
    entries.set(key, result);
    if (entries.size > limit) {
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    return result;
  } as BoundedCache<Result>;

  cached.clear = () => entries.clear();

  return cached;
}
