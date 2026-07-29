/**
 * A keyed cache with a hard entry cap, for memoizing pure functions whose inputs
 * repeat many times within a lint run (e.g. the analysis of a partial that is
 * rendered from dozens of call sites).
 *
 * Eviction is insertion-order (oldest first), not least-recently-used: the
 * access pattern here is "many hits on a working set that fits", so LRU
 * bookkeeping would buy nothing. The cap exists so a huge project — or a
 * long-lived server process linting many projects — cannot grow the cache
 * without bound.
 *
 * Callers are expected to key on the exact input the result depends on
 * (typically file content), so an entry can never be stale: changed content is a
 * different key, and the old entry ages out.
 */
export function createBoundedCache<Result>(limit: number) {
  const entries = new Map<string, Result>();

  return function cached(key: string, compute: () => Result): Result {
    // `has` rather than a truthiness check: `undefined`/`null`/`false` are
    // legitimate cached results and must count as hits.
    if (entries.has(key)) return entries.get(key)!;

    const result = compute();
    entries.set(key, result);
    if (entries.size > limit) {
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    return result;
  };
}
