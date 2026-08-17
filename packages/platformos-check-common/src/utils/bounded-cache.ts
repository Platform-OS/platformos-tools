/**
 * A keyed cache with a hard entry cap, for memoizing pure functions whose inputs repeat many
 * times within a lint run (e.g. the analysis of a partial rendered from dozens of call sites).
 *
 * Eviction is least-recently-used, so a working set that fits under the cap survives however
 * much one-off traffic flows past it. Plain insertion order would evict the frequently-rendered
 * partials first — exactly the entries the cache exists for.
 *
 * Callers key on the exact input the result depends on. Where that input is the TEXT the answer
 * is about, an entry can never be stale: changed text is a different key.
 *
 * A caller may instead key on IDENTITY and revalidate on the way out, which is what the
 * partial-analysis memo in `checks/unknown-property/shape-analysis.ts` does. That keeps the key
 * small when the answer depends on several files, and it moves the burden — a key that omits
 * something the answer depends on, and a revalidation that reads from somewhere other than
 * where the analysis read, are both stale-cache bugs this class cannot catch for you.
 *
 * `clear()` drops everything, so tests stay independent and a long-lived host that switches
 * projects can release the previous project's entries.
 */
export interface BoundedCache<Result> {
  (key: string, compute: () => Result): Result;
  clear(): void;
}

export function createBoundedCache<Result>(limit: number): BoundedCache<Result> {
  const entries = new Map<string, Result>();

  const cached = (key: string, compute: () => Result): Result => {
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
  };

  return Object.assign(cached, { clear: () => entries.clear() });
}
