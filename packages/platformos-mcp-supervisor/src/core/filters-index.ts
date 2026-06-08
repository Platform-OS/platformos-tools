/**
 * Filter docset index — name → typed metadata for every known Liquid
 * filter, populated from the platformOS docset shipped by
 * `@platformos/platformos-check-docs-updater`.
 *
 * Consumed by `error-enricher` and `fix-generator` (for "did you mean?"
 * suggestions on `UnknownFilter`) plus the `UnknownFilter` rule.
 *
 * Source data layout in the docset (per `FilterEntry`): `name`, `category`,
 * `syntax`, `summary`, `parameters`, `deprecated`. The shipping JSON also
 * carries `platformOS: boolean` per entry (not in the public type) — used
 * to surface the platformOS-only subset for tooltips/lists.
 */

import type { FilterEntry, Parameter, PlatformOSDocset } from '@platformos/platformos-check-common';
import { FILTER_MATCH_MAX_DISTANCE } from './constants';

/**
 * Runtime view of a filter entry. Slimmed from the upstream `FilterEntry`
 * to the fields consumers actually read; `platformOS` is added because the
 * shipping JSON populates it even though the public type doesn't declare it.
 */
export interface FilterDef {
  name: string;
  category: string;
  syntax: string;
  summary: string;
  parameters: Parameter[];
  platformOS: boolean;
  deprecated: boolean;
}

/** Shipping JSON shape — extends the public type with the optional flag. */
type ShippedFilterEntry = FilterEntry & { platformOS?: boolean };

export class FiltersIndex {
  private _byName = new Map<string, FilterDef>();
  private _loaded = false;

  /**
   * Populate the index from the docset's filter list.
   *
   * `setup()` on `PlatformOSLiquidDocsManager` runs an upstream-revision
   * check + download — callers that want the offline-only path should pass
   * a docset whose `filters()` reads from disk (the default behaviour
   * before `setup()` is called).
   */
  async load(docset: PlatformOSDocset): Promise<void> {
    const entries = (await docset.filters()) as ShippedFilterEntry[];
    for (const f of entries) {
      this._byName.set(f.name, {
        name: f.name,
        category: f.category ?? '',
        syntax: f.syntax ?? '',
        summary: f.summary ?? '',
        parameters: f.parameters ?? [],
        platformOS: f.platformOS === true,
        deprecated: f.deprecated === true,
      });
    }
    this._loaded = true;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  lookup(filterName: string | null | undefined): FilterDef | null {
    if (!this._loaded || !filterName) return null;
    return this._byName.get(filterName) ?? null;
  }

  lookupMany(filterNames: Iterable<string>): FilterDef[] {
    if (!this._loaded) return [];
    const results: FilterDef[] = [];
    for (const name of filterNames) {
      const f = this._byName.get(name);
      if (f) results.push(f);
    }
    return results;
  }

  /**
   * Find the closest filter name by Levenshtein distance, capped at
   * `maxDistance`. Used by `UnknownFilter` rule + enricher fallback for
   * "did you mean?" suggestions.
   */
  closestMatch(
    filterName: string | null | undefined,
    maxDistance: number = FILTER_MATCH_MAX_DISTANCE,
  ): FilterDef | null {
    if (!this._loaded || !filterName) return null;
    const lower = filterName.toLowerCase();
    let best: FilterDef | null = null;
    let bestDist = maxDistance + 1;
    for (const entry of this._byName.values()) {
      const d = levenshtein(lower, entry.name.toLowerCase());
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  /** Sorted list of platformOS-only, non-deprecated filters. */
  platformOSFilters(): FilterDef[] {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter((f) => f.platformOS && !f.deprecated)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
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
