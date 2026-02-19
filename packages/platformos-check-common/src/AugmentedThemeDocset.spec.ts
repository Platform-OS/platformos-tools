import { describe, beforeEach, it, expect } from 'vitest';
import { AugmentedThemeDocset } from './AugmentedThemeDocset';
import { ThemeDocset } from './types';

describe('Module: AugmentedThemeDocset', async () => {
  let themeDocset: ThemeDocset;

  beforeEach(async () => {
    themeDocset = new AugmentedThemeDocset({
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
      tags: async () => [],
      systemTranslations: async () => ({}),
    });
  });

  describe('filters', async () => {
    it('should return filters with undocumented filters', async () => {
      const filters = await themeDocset.filters();

      expect(filters).to.have.length.greaterThanOrEqual(30);
    });

    it('should return valid filter entries', async () => {
      const filters = await themeDocset.filters();

      expect(filters).to.deep.include({ name: 'h' });
    });

    it('should expand aliases from filter entries', async () => {
      const docset = new AugmentedThemeDocset({
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
        tags: async () => [],
        systemTranslations: async () => ({}),
      });

      const filters = await docset.filters();
      const names = filters.map((f) => f.name);

      expect(names).toContain('parse_json');
      expect(names).toContain('to_hash');
    });

    it('should copy all properties from base filter to alias entry', async () => {
      const docset = new AugmentedThemeDocset({
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
        tags: async () => [],
        systemTranslations: async () => ({}),
      });

      const filters = await docset.filters();
      const aliasEntry = filters.find((f) => f.name === 't');

      expect(aliasEntry).toBeDefined();
      expect(aliasEntry!.summary).toBe('Translates a key');
      expect(aliasEntry!.syntax).toBe('string | translate');
      expect(aliasEntry!.parameters).toHaveLength(1);
    });

    it('should expand multiple aliases for a single filter', async () => {
      const docset = new AugmentedThemeDocset({
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
        tags: async () => [],
        systemTranslations: async () => ({}),
      });

      const filters = await docset.filters();
      const names = filters.map((f) => f.name);

      expect(names).toContain('hash_add_key');
      expect(names).toContain('add_hash_key');
      expect(names).toContain('assign_to_hash_key');
    });

    it('should not add aliases for filters without aliases', async () => {
      const docset = new AugmentedThemeDocset({
        graphQL: async () => null,
        filters: async () => [
          { name: 'upcase', summary: 'Uppercases a string' },
          { name: 'downcase', summary: 'Downcases a string' },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      });

      const filters = await docset.filters();
      const officialNames = filters.filter((f) => f.name === 'upcase' || f.name === 'downcase');

      expect(officialNames).toHaveLength(2);
    });
  });

  describe('objects', async () => {
    it('should return objects with undocumented objects', async () => {
      const objects = await themeDocset.objects();

      expect(objects).to.have.length.greaterThanOrEqual(15);
    });

    it('should return valid object entries', async () => {
      const objects = await themeDocset.objects();

      expect(objects).to.deep.include({ name: 'customer_address' });
      expect(objects).to.deep.include({
        name: 'locale',
        access: {
          global: false,
          parents: [],
          template: [],
        },
        return_type: [
          {
            type: 'string',
            name: '',
          },
        ],
      });
    });
  });

  describe('liquidDrops', async () => {
    it('should return non-deprecated objects', async () => {
      const objects = await themeDocset.liquidDrops();

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
      const objects = await themeDocset.liquidDrops();

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
    it('should return tags with undocumented tags', async () => {
      const tags = await themeDocset.tags();

      expect(tags).have.length.greaterThanOrEqual(4);
    });

    it('should return valid tag entries', async () => {
      const tags = await themeDocset.tags();

      expect(tags).to.deep.include({ name: 'elsif' });
    });
  });
});
