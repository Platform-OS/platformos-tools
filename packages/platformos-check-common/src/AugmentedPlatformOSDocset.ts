import {
  FilterEntry,
  ObjectEntry,
  TagEntry,
  PlatformOSDocset,
} from './types';
import { memo } from './utils';

const toFilterEntry = (name: string): FilterEntry => ({ name });

const expandAliases = (entries: FilterEntry[]): FilterEntry[] => {
  return entries.flatMap((entry) => {
    const aliases: string[] = (entry as any).aliases ?? [];
    return aliases.map((alias) => ({ ...entry, name: alias }));
  });
};

/**
 * Filters that are valid in platformOS but not yet in the official docs.
 */
const undocumentedFilters = [
  'debug',
  'distance_from',
  'encode_url_component',
  'excerpt',
  'format_code',
  'h',
  'handle_from',
  'pad_spaces',
  'paragraphize',
  'sentence',
  'unit',
  'weight',
];

const toTagEntry = (name: string): TagEntry => ({ name });

/**
 * Tags that are valid in platformOS Liquid but not yet in the official docs.
 */
const undocumentedTags = ['elsif', 'ifchanged', 'when'];

export class AugmentedPlatformOSDocset implements PlatformOSDocset {
  constructor(private platformosDocset: PlatformOSDocset) {}
  graphQL = memo(async (): Promise<string | null> => {
    return await this.platformosDocset.graphQL();
  });

  public isAugmented = true;

  filters = memo(async (): Promise<FilterEntry[]> => {
    const officialFilters = await this.platformosDocset.filters();
    return [
      ...officialFilters,
      ...expandAliases(officialFilters),
      ...undocumentedFilters.map(toFilterEntry),
    ];
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
    return [...(await this.platformosDocset.tags()), ...undocumentedTags.map(toTagEntry)];
  });

}
