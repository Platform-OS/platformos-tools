import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { ObjectEntry } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('Module: LiquidObjectAttributeHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    // SYNTHETIC names. These tests need an object with an array-valued property, which no real
    // platformOS object has; the previous spelling borrowed Shopify's `item`/`image` for it and
    // so read as documentation of an API that does not exist.
    const _objects: ObjectEntry[] = [
      {
        name: 'record_type',
        description: 'record_type description',
        return_type: [],
        properties: [
          {
            name: 'featured_item',
            description: 'featured_item description',
            return_type: [{ type: 'item_type', name: '' }],
          },
          {
            name: 'items',
            description: 'items description',
            return_type: [{ type: 'array', array_value: 'item_type' }],
          },
          {
            name: 'title',
            return_type: [{ type: 'string', name: '' }],
          },
        ],
      },
      {
        name: 'item_type',
        description: 'description of the item type',
        properties: [
          {
            name: 'height',
            description: 'height description',
            return_type: [{ type: 'number', name: '' }],
          },
        ],
        access: {
          global: false,
          parents: [],
          template: [],
        },
      },
    ];

    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => _objects,
        liquidDrops: async () => _objects,
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
    );
  });

  it('should return the hover description of the object property', async () => {
    const contexts = [
      '{{ record_type.feat█ured_item }}',
      '{{ record_type.featured_item█ }}',
      '{% echo record_type.featured_item█ %}',
      '{% liquid\n echo record_type.featured_item█ %}',
    ];
    for (const context of contexts) {
      await expect(provider).to.hover(
        context,
        expect.stringContaining('featured_item description'),
      );
      await expect(provider).to.hover(
        context,
        expect.stringMatching(/##* featured_item: `item_type`/),
      );
    }
  });

  describe('when hovering over an array built-in method', () => {
    it('should return the hover description of the object property', async () => {
      const contexts = [
        '{{ record_type.items.█first }}',
        '{{ record_type.items.first█ }}',
        '{{ record_type.items.last█ }}',
        '{% echo record_type.items.first█ %}',
      ];
      for (const context of contexts) {
        await expect(provider).to.hover(
          context,
          expect.stringMatching(/##* (first|last): `item_type`/),
        );
        await expect(provider, context).to.hover(
          context,
          expect.stringContaining('description of the item type'),
        );
      }
    });

    it('should return not arbitrarily return the type of the last property', async () => {
      await expect(provider).to.hover(
        '{{ record_type.items.first█.height }}',
        expect.stringMatching(/##* first: `item_type`/),
      );
      await expect(provider).to.hover(
        '{{ record_type.items.firs█t.height }}',
        expect.stringMatching(/##* first: `item_type`/),
      );
    });

    it('should return the hover description number properties', async () => {
      const contexts = ['{{ record_type.items.size█ }}', '{% echo record_type.items.size█ %}'];
      for (const context of contexts) {
        await expect(provider).to.hover(context, expect.stringMatching(/##* size: `number`/));
      }
    });

    it('should return nothing if there are no docs for that attribute', async () => {
      const contexts = ['{{ record_type.items.length█ }}', '{% echo record_type.items.length█ %}'];
      for (const context of contexts) {
        await expect(provider).to.hover(context, null);
      }
    });
  });

  describe('when hovering over built-in methods of built-in types', () => {
    it('should return info for size', async () => {
      const contexts = [
        '{{ record_type.title.size█ }}',
        '{{ record_type.title.first.size█ }}',
        '{% echo record_type.title.size█ %}',
      ];
      for (const context of contexts) {
        await expect(provider).to.hover(context, expect.stringMatching(/##* size: `number`/));
      }
    });

    it('should return info for first/last of strings', async () => {
      const contexts = [
        '{{ record_type.title.last█ }}',
        '{{ record_type.title.first█ }}',
        '{{ record_type.title.first.first█ }}',
        '{% echo record_type.title.first█ %}',
      ];
      for (const context of contexts) {
        await expect(provider).to.hover(
          context,
          expect.stringMatching(/##* (first|last): `string`/),
        );
      }
    });

    it('should return nothing for unknown attributes of built-ins', async () => {
      const contexts = ['{{ record_type.title.length█ }}', '{% echo record_type.title.unknown█ %}'];
      for (const context of contexts) {
        await expect(provider).to.hover(context, null);
      }
    });
  });

  describe('when the parent is untyped', () => {
    it('should show a hover window (it is like any of any)', async () => {
      await expect(provider).to.hover(
        `{% assign x = record_type.foo %}
         {{ x.bar█ }}`,
        expect.stringMatching(/##* bar: `untyped`/),
      );
    });
  });

  it('should return nothing if there are no docs for that attribute', async () => {
    await expect(provider).to.hover(`{{ record_type.featured_foo█ }}`, null);
  });

  describe('when hovering over parse_json variables', () => {
    it('should return type info for object properties', async () => {
      await expect(provider).to.hover(
        `{% assign a = '{"name": "test", "count": 5}' | parse_json %}
         {{ a.name█ }}`,
        expect.stringMatching(/##* name: `string`/),
      );
    });

    it('should return type info for nested object properties', async () => {
      await expect(provider).to.hover(
        `{% assign a = '{"user": {"id": 1, "name": "test"}}' | parse_json %}
         {{ a.user█ }}`,
        expect.stringMatching(/##* user: `object`/),
      );
      await expect(provider).to.hover(
        `{% assign a = '{"user": {"id": 1, "name": "test"}}' | parse_json %}
         {{ a.user█ }}`,
        expect.stringContaining('Keys: id, name'),
      );
    });

    it('should return type info for array properties', async () => {
      await expect(provider).to.hover(
        `{% assign a = '{"items": [1, 2, 3]}' | parse_json %}
         {{ a.items█ }}`,
        expect.stringMatching(/##* items: `number\[\]`/),
      );
    });

    it('should return type info for nested array properties', async () => {
      await expect(provider).to.hover(
        `{% assign a = '[{"name": "test"}]' | parse_json %}
         {{ a.first█ }}`,
        expect.stringMatching(/##* first: `object`/),
      );
    });

    it('should return type info for parse_json block syntax', async () => {
      await expect(provider).to.hover(
        `{% parse_json data %}
           {"status": "active", "count": 5}
         {% endparse_json %}
         {{ data.status█ }}`,
        expect.stringMatching(/##* status: `string`/),
      );
    });

    it('should return type info for hash_assign with parse_json value', async () => {
      await expect(provider).to.hover(
        `{% assign a = '{}' | parse_json %}
         {% hash_assign a['nested'] = '{"deep": "value"}' | parse_json %}
         {{ a.nested█ }}`,
        expect.stringMatching(/##* nested: `object`/),
      );
    });
  });
});
