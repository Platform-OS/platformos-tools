import { FilterEntry, LiquidDocVocabulary, ObjectEntry, TagEntry, PlatformOSDocset } from './types';
import { memo } from './utils';

const expandAliases = (entries: FilterEntry[]): FilterEntry[] => {
  return entries.flatMap((entry) => {
    // `aliases` is a declared field on FilterEntry now; it always was in the data.
    return (entry.aliases ?? []).map((alias) => ({ ...entry, name: alias }));
  });
};

export class AugmentedPlatformOSDocset implements PlatformOSDocset {
  constructor(private platformosDocset: PlatformOSDocset) {}
  graphQL = memo(async (): Promise<string | null> => {
    return await this.platformosDocset.graphQL();
  });

  public isAugmented = true;

  /** The published filters, plus one entry per alias. */
  filters = memo(async (): Promise<FilterEntry[]> => {
    const officialFilters = await this.platformosDocset.filters();

    return [...officialFilters, ...expandAliases(officialFilters)];
  });

  objects = memo(async (): Promise<ObjectEntry[]> => {
    return await this.platformosDocset.objects();
  });

  liquidDrops = memo(async (): Promise<ObjectEntry[]> => {
    return (await this.platformosDocset.objects()).filter((obj) => {
      if (!obj.access) {
        return true;
      }

      if (obj.deprecated) {
        return false;
      }

      // objects that are accessible outside Global context
      return !obj.access.global || (obj.access.global && obj.access.parents.length > 0);
    });
  });

  tags = memo(async (): Promise<TagEntry[]> => {
    return await this.platformosDocset.tags();
  });

  liquidDoc = memo(async (): Promise<LiquidDocVocabulary> => {
    return await this.platformosDocset.liquidDoc();
  });
}
