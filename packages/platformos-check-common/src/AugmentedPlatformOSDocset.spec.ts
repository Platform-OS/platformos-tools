import { describe, beforeEach, it, expect } from 'vitest';
import { AugmentedPlatformOSDocset } from './AugmentedPlatformOSDocset';
import { UNDOCUMENTED_FILTERS } from './undocumented-filters';
import { PlatformOSDocset } from './types';

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
      tags: async () => [],
    });
  });

  describe('filters', async () => {
    it('should return exactly the undocumented filters when the docset has none', async () => {
      // This mock's `filters()` returns [], so everything here comes from the
      // undocumented list — which makes the composition exactly assertable.
      //
      // It used to assert `length >= 10`, a threshold standing in for the 13
      // hand-typed entries of the day. That hid what it was really checking: when the
      // list was regenerated from a live instance and 12 fictional filters were
      // dropped, the failure read as "expected at least 10, got 6" rather than naming
      // the change. Comparing against the list itself pins the WIRING (official +
      // aliases + undocumented, each as a `{ name }` entry) and lets
      // `undocumented-filters.spec.ts` own the contents.
      const filters = await platformosDocset.filters();

      // THIS ASSERTION IS THE LANGUAGE SERVER BOUNDARY. `startServer.ts` builds this same
      // `AugmentedPlatformOSDocset`, so whatever shape appears here is what the LSP's
      // `TypeSystem` consumes — and `docsetEntryReturnType` defaults a filter with no
      // `return_type` to `'string'`.
      //
      // Adding `return_type` to these entries would therefore retype them for completions
      // and hover (`sum` -> number, `where` -> array, `find` -> hash, `has` -> boolean).
      // That is very likely an IMPROVEMENT, but `TypeSystem.spec.ts` injects a mock docset
      // and would not catch a regression, so the change cannot be verified where it lands.
      //
      // The measured types live in `UNDOCUMENTED_FILTER_RETURN_TYPES` instead, consumed
      // only by `InvalidHashAssignTarget`. Keeping the entries bare makes the LSP delta
      // provably zero — same code path, same input — rather than probably fine. If you
      // want the LSP improvement, do it as its own change with tests that drive the real
      // augmented docset, and expect this assertion to change with it.
      expect(filters).toEqual(UNDOCUMENTED_FILTERS.map((name) => ({ name })));
    });

    it('should return valid filter entries', async () => {
      const filters = await platformosDocset.filters();

      expect(filters).to.deep.include({ name: 'h' });
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
        tags: async () => [],
      });

      const filters = await docset.filters();
      const officialNames = filters.filter((f) => f.name === 'upcase' || f.name === 'downcase');

      expect(officialNames).toHaveLength(2);
    });

    it('should normalize filters with deprecated:false but deprecation_reason:"true" to deprecated:true', async () => {
      const docset = new AugmentedPlatformOSDocset({
        graphQL: async () => null,
        filters: async () => [
          { name: 'asset_path', deprecated: false, deprecation_reason: 'true' },
          { name: 'sha1', deprecated: false, deprecation_reason: 'true' },
          { name: 'active_filter', deprecated: false, deprecation_reason: 'false' },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      });

      const filters = await docset.filters();
      const assetPath = filters.find((f) => f.name === 'asset_path');
      const sha1 = filters.find((f) => f.name === 'sha1');
      const active = filters.find((f) => f.name === 'active_filter');

      expect(assetPath?.deprecated).toBe(true);
      expect(assetPath?.deprecation_reason).toBeUndefined();
      expect(sha1?.deprecated).toBe(true);
      expect(sha1?.deprecation_reason).toBeUndefined();
      expect(active?.deprecated).toBeFalsy();
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
    it('should return tags with undocumented tags', async () => {
      const tags = await platformosDocset.tags();

      expect(tags).have.length.greaterThanOrEqual(3);
    });

    it('should return valid tag entries', async () => {
      const tags = await platformosDocset.tags();

      expect(tags).to.deep.include({ name: 'elsif' });
    });
  });
});
