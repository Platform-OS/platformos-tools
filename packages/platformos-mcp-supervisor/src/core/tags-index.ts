/**
 * Tag docset index — name → typed metadata for every known Liquid tag,
 * populated from the platformOS docset shipped by
 * `@platformos/platformos-check-docs-updater`.
 *
 * Consumed by `error-enricher`, `fix-generator`, and the
 * `LiquidHTMLSyntaxError` rule (to disambiguate "unknown tag" vs
 * "tag-used-as-filter" and to surface "did you mean?" lists).
 *
 * Same `platformOS: boolean` quirk as filters: the field exists in the
 * shipping JSON but not in the public `TagEntry` type.
 */

import type { Parameter, PlatformOSDocset, TagEntry } from '@platformos/platformos-check-common';

export interface TagDef {
  name: string;
  syntax: string;
  summary: string;
  parameters: Parameter[];
  platformOS: boolean;
  deprecated: boolean;
}

type ShippedTagEntry = TagEntry & { platformOS?: boolean };

export class TagsIndex {
  private _byName = new Map<string, TagDef>();
  private _loaded = false;

  async load(docset: PlatformOSDocset): Promise<void> {
    const entries = (await docset.tags()) as ShippedTagEntry[];
    for (const t of entries) {
      this._byName.set(t.name, {
        name: t.name,
        syntax: t.syntax ?? '',
        summary: t.summary ?? '',
        parameters: t.parameters ?? [],
        platformOS: t.platformOS === true,
        deprecated: t.deprecated === true,
      });
    }
    this._loaded = true;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  lookup(tagName: string | null | undefined): TagDef | null {
    if (!this._loaded || !tagName) return null;
    return this._byName.get(tagName) ?? null;
  }

  lookupMany(tagNames: Iterable<string>): TagDef[] {
    if (!this._loaded) return [];
    const results: TagDef[] = [];
    for (const name of tagNames) {
      const t = this._byName.get(name);
      if (t) results.push(t);
    }
    return results;
  }

  /** Sorted list of platformOS-only, non-deprecated tags. */
  platformOSTags(): TagDef[] {
    if (!this._loaded) return [];
    return [...this._byName.values()]
      .filter((t) => t.platformOS && !t.deprecated)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** True if the docset knows this tag name. */
  isTag(name: string | null | undefined): boolean {
    if (!this._loaded || !name) return false;
    return this._byName.has(name);
  }
}
