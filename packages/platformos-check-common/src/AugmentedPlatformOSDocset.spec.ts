import { describe, beforeEach, it, expect } from 'vitest';
import { AugmentedPlatformOSDocset } from './AugmentedPlatformOSDocset';
import { FilterEntry, PlatformOSDocset } from './types';
import { publishedLiquidDoc } from './test/published-docset';

describe('Module: AugmentedPlatformOSDocset', async () => {
  let platformosDocset: PlatformOSDocset;

  beforeEach(async () => {
    platformosDocset = new AugmentedPlatformOSDocset({
      graphQL: async () => null,
      filters: async () => [],
      objects: async () => [
        {
          name: 'test-object',
          access: {
            global: false,
            parents: [],
            template: [],
          },
        },
        {
          name: 'deprecated-test-object',
          deprecated: true,
          access: {
            global: false,
            parents: [],
            template: [],
          },
        },
        {
          name: 'exclusive-global-test-object',
          access: {
            global: true,
            parents: [],
            template: [],
          },
        },
        {
          name: 'global-test-object-with-parents',
          access: {
            global: true,
            parents: [
              {
                object: 'parent-test-object',
                property: 'parent-property',
              },
            ],
            template: [],
          },
        },
      ],
      liquidDrops: async () => [],
      liquidDoc: async () => ({ annotations: [], param_types: [] }),
      tags: async () => [],
    });
  });

  describe('filters', async () => {
    it('returns nothing of its own when the docset publishes no filters', async () => {
      // The only entries this class adds to a docset are alias expansions.
      const filters = await platformosDocset.filters();

      expect(filters).toEqual([]);
    });

    it('should expand aliases from filter entries', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [
          {
            name: 'parse_json',
            summary: 'Parses a JSON string',
            aliases: ['to_hash'],
            return_type: [{ type: 'hash', name: '' }],
          } as any,
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      });

      const filters = await docset.filters();
      const names = filters.map((f) => f.name);

      expect(names).toContain('parse_json');
      expect(names).toContain('to_hash');
    });

    it('should copy all properties from base filter to alias entry', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [
          {
            name: 'translate',
            summary: 'Translates a key',
            syntax: 'string | translate',
            parameters: [
              {
                name: 'scope',
                required: false,
                positional: false,
                types: ['string'],
                description: '',
              },
            ],
            aliases: ['t'],
          } as any,
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      });

      const filters = await docset.filters();
      const aliasEntry = filters.find((f) => f.name === 't');

      expect(aliasEntry).toBeDefined();
      expect(aliasEntry!.summary).toBe('Translates a key');
      expect(aliasEntry!.syntax).toBe('string | translate');
      expect(aliasEntry!.parameters).toHaveLength(1);
    });

    it('should expand multiple aliases for a single filter', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [
          {
            name: 'hash_add_key',
            summary: 'Adds a key to a hash',
            aliases: ['add_hash_key', 'assign_to_hash_key'],
          } as any,
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      });

      const filters = await docset.filters();
      const names = filters.map((f) => f.name);

      expect(names).toContain('hash_add_key');
      expect(names).toContain('add_hash_key');
      expect(names).toContain('assign_to_hash_key');
    });

    it('should not add aliases for filters without aliases', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [
          { name: 'upcase', summary: 'Uppercases a string' },
          { name: 'downcase', summary: 'Downcases a string' },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      });

      const filters = await docset.filters();
      const officialNames = filters.filter((f) => f.name === 'upcase' || f.name === 'downcase');

      expect(officialNames).toHaveLength(2);
    });
  });

  describe('objects', async () => {
    it('should return objects from the official docset', async () => {
      const objects = await platformosDocset.objects();

      expect(objects).to.have.length.greaterThanOrEqual(4);
    });

    it('should return valid object entries', async () => {
      const objects = await platformosDocset.objects();

      expect(objects).to.deep.include({
        name: 'test-object',
        access: {
          global: false,
          parents: [],
          template: [],
        },
      });
    });
  });

  describe('liquidDrops', async () => {
    it('should return non-deprecated objects', async () => {
      const objects = await platformosDocset.liquidDrops();

      expect(objects).to.have.lengthOf(2);
      expect(objects).to.deep.include({
        name: 'test-object',
        access: {
          global: false,
          parents: [],
          template: [],
        },
      });
    });

    it("should return objects that aren't exclusively global", async () => {
      const objects = await platformosDocset.liquidDrops();

      expect(objects).to.have.lengthOf(2);
      expect(objects).to.deep.include({
        name: 'global-test-object-with-parents',
        access: {
          global: true,
          parents: [
            {
              object: 'parent-test-object',
              property: 'parent-property',
            },
          ],
          template: [],
        },
      });
    });
  });

  describe('tags', async () => {
    it('should pass the documented tags through unchanged', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [{ name: 'assign', summary: 'from the docs' }],
      });

      expect(await docset.tags()).toEqual([{ name: 'assign', summary: 'from the docs' }]);
    });
  });

  describe('liquidDoc', async () => {
    /**
     * The `{% doc %}` vocabulary passes through untouched and is asked for ONCE per run: three features
     * read it — the annotation completions, their hover, and the param-type list — and each of them asks
     * per keystroke or per file.
     */
    it('passes the published vocabulary through, and asks for it once', async () => {
      let calls = 0;
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        liquidDoc: async () => {
          calls += 1;
          return publishedLiquidDoc;
        },
      });

      expect([await docset.liquidDoc(), await docset.liquidDoc()]).toEqual([
        publishedLiquidDoc,
        publishedLiquidDoc,
      ]);
      expect(calls).toBe(1);
    });
  });
});

/**
 * THE DOCSET IS THE WHOLE FILTER VOCABULARY. This package holds no list of its own, and the
 * augmentation must not grow one back: its only job on `filters()` is to re-emit each published
 * entry under its aliases.
 *
 * The guard is worth its weight because the failure is quiet. A locally injected `{ name }` carries
 * neither `arity` nor `return_type`, and both `InvalidWriteTarget` and `FilterArity` resolve a
 * filter by name — so an entry appended beside a published one does not throw, it silently answers
 * "unknown" for a filter the platform fully documents.
 */
describe('AugmentedPlatformOSDocset: the published filters, and nothing beside them', () => {
  const docsetOf = (filters: FilterEntry[]) =>
    new AugmentedPlatformOSDocset({
      async filters() {
        return filters;
      },
      async objects() {
        return [];
      },
      async liquidDrops() {
        return [];
      },
      async liquidDoc() {
        return { annotations: [], param_types: [] };
      },
      async tags() {
        return [];
      },
      async graphQL() {
        return null;
      },
    } as any);

  it('passes a published entry through untouched, adding nothing beside it', async () => {
    // The whole list is asserted, not just that `where` is in it, so an added entry fails here.
    const published: FilterEntry = {
      name: 'where',
      arity: { min: 2, max: 3 },
      return_type: [{ type: 'array', array_value: '' }],
    };

    const filters = await docsetOf([published]).filters();

    expect(filters).toEqual([published]);
  });
});
