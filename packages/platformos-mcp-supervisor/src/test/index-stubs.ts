/**
 * Shared stub factories for the FiltersIndex / ObjectsIndex / TagsIndex
 * surfaces that fix-generator + error-enricher specs need.
 *
 * Source tests poked at `_loaded` / `_byName` private fields. v1's TS types
 * mark those private, so we instead synthesise objects that match the
 * public interface and cast at the boundary (`as unknown as FiltersIndex`,
 * etc.). The shape contracts that matter are documented per stub.
 */

import type { FiltersIndex } from '../core/filters-index';
import type { ObjectsIndex } from '../core/objects-index';
import type { TagsIndex } from '../core/tags-index';

export interface FilterStubEntry {
  category?: string;
  syntax?: string;
  summary?: string;
}

export interface ObjectStubEntry {
  handle: string;
  properties: string[];
}

export interface TagStubEntry {
  syntax?: string;
  summary?: string;
}

/** Construct a stub FiltersIndex pre-populated with the given entries. */
export function stubFiltersIndex(
  entries: Record<string, FilterStubEntry>,
): FiltersIndex {
  const map = new Map(Object.entries(entries));
  return {
    loaded: true,
    lookup: (name: string | null | undefined) => {
      if (!name) return null;
      const e = map.get(name);
      return e
        ? {
            name,
            category: e.category ?? '',
            syntax: e.syntax ?? '',
            summary: e.summary ?? '',
            parameters: [],
            platformOS: false,
            deprecated: false,
          }
        : null;
    },
    closestMatch: (name: string | null | undefined) => {
      if (!name) return null;
      const target = name.toLowerCase();
      let best: { key: string; entry: FilterStubEntry } | null = null;
      let bestDistance = Infinity;
      for (const [key, entry] of map) {
        if (key.toLowerCase() === target) continue;
        const distance = levenshtein(key.toLowerCase(), target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { key, entry };
        }
      }
      if (!best || bestDistance > 3) return null;
      return {
        name: best.key,
        category: best.entry.category ?? '',
        syntax: best.entry.syntax ?? '',
        summary: best.entry.summary ?? '',
        parameters: [],
        platformOS: false,
        deprecated: false,
      };
    },
  } as unknown as FiltersIndex;
}

export function stubObjectsIndex(
  entries: Record<string, ObjectStubEntry>,
): ObjectsIndex {
  const map = new Map(Object.entries(entries));
  return {
    loaded: true,
    lookup: (name: string | null | undefined) => {
      if (!name) return null;
      const e = map.get(name);
      if (!e) return null;
      if (!e.handle || e.handle === name) return null;
      return { name, handle: e.handle, properties: e.properties };
    },
  } as unknown as ObjectsIndex;
}

export function stubTagsIndex(names: string[]): TagsIndex {
  const set = new Set(names);
  return {
    isTag: (n: string | null | undefined) => !!n && set.has(n),
  } as unknown as TagsIndex;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
