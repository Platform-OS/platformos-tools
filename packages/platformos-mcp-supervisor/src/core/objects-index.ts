/**
 * Object docset index — name → typed metadata for every documented
 * platformOS Liquid object, populated from the docset shipped by
 * `@platformos/platformos-check-docs-updater`.
 *
 * Consumed by `error-enricher` and `fix-generator` (for `UndefinedObject`
 * Shopify-vs-platformOS suggestions) plus the `UnknownProperty` rule.
 *
 * Source data carries each object's authoritative `handle` (e.g.
 * `context.params`, `context.current_user`) in `json_data.handle`. The
 * shipping JSON populates this field even though the public `JsonData`
 * type comments it out.
 */

import type { ObjectEntry, PlatformOSDocset } from '@platformos/platformos-check-common';

export interface ObjectDef {
  name: string;
  /** Canonical accessor path, e.g. `context.params`, `context.current_user`. */
  handle: string;
  /** Property names available on the object. */
  properties: string[];
}

/**
 * The docset's `JsonData` interface omits `handle` (commented out in
 * `platformos-check-common/src/types/platformos-liquid-docs.ts`), but the
 * shipping JSON does include it. Extend locally so the typed lookup works.
 */
type ShippedObjectEntry = ObjectEntry & { json_data?: { handle?: string } };

export class ObjectsIndex {
  private _byName = new Map<string, ObjectDef>();
  private _loaded = false;

  async load(docset: PlatformOSDocset): Promise<void> {
    const entries = (await docset.objects()) as ShippedObjectEntry[];
    for (const obj of entries) {
      const handle = obj.json_data?.handle ?? '';
      const propNames = (obj.properties ?? [])
        .map((p) => p.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      this._byName.set(obj.name, { name: obj.name, handle, properties: propNames });
    }
    this._loaded = true;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  /**
   * Objects whose handle starts with `context.` — the agent-facing accessor
   * surface (`context.params`, `context.session`, `context.current_user`, …).
   * Ordered by property count desc so denser objects surface first in
   * lists.
   */
  contextObjects(): ObjectDef[] {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter((obj) => /^context\.[a-z_]+$/.test(obj.handle))
      .sort((a, b) => b.properties.length - a.properties.length);
  }

  /**
   * Look up a bare variable name. Returns `null` when:
   *   - the name is not in the docset,
   *   - the entry has no `handle` (not addressable from Liquid),
   *   - the handle equals the bare name (no rename suggestion possible).
   */
  lookup(varName: string | null | undefined): ObjectDef | null {
    if (!this._loaded || !varName) return null;
    const obj = this._byName.get(varName);
    if (!obj) return null;
    if (!obj.handle || obj.handle === varName) return null;
    return obj;
  }
}

/**
 * Extract a quoted variable name from a diagnostic message. Double quotes
 * win, single quotes fall through. Returns `null` when no match.
 */
export function extractVarName(message: string | null | undefined): string | null {
  if (!message) return null;
  const dq = message.match(/"([^"]+)"/);
  if (dq) return dq[1];
  const sq = message.match(/'([^']+)'/);
  if (sq) return sq[1];
  return null;
}
