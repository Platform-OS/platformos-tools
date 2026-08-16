import { describe, beforeEach, it, expect, vi } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import { DocumentManager } from '../../documents';
import { CompletionsProvider } from '../CompletionsProvider';
import { ObjectEntry } from '@platformos/platformos-check-common';

describe('Module: ObjectAttributeCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    // SYNTHETIC names, deliberately. These fixtures need a shape platformOS does not publish — an
    // object with an array-valued property — and the previous spelling borrowed Shopify's
    // `item.images` / `image` for it, which reads as documentation of an API that does not
    // exist. A name no docset could contain cannot be mistaken for one.
    const _objects: ObjectEntry[] = [
      {
        name: 'no_properties',
        properties: [],
      },
      {
        name: 'global_default',
        properties: [{ name: 'prop1' }, { name: 'prop2' }],
      },
      {
        name: 'global_access',
        access: {
          global: true,
          parents: [],
          template: [],
        },
        properties: [{ name: 'prop3' }, { name: 'prop4' }],
      },
      {
        name: 'global_with_items',
        access: {
          global: true,
          parents: [],
          template: [],
        },
        properties: [
          {
            name: 'items',
            return_type: [
              {
                type: 'array',
                array_value: 'item_type',
              },
            ],
          },
        ],
      },
      {
        name: 'item_type',
        access: {
          global: false, // a type reached through a parent, never a variable of its own
          parents: [],
          template: [],
        },
        properties: [
          { name: 'src', return_type: [{ type: 'string', name: '' }] },
          { name: 'width', return_type: [{ type: 'number', name: '' }] },
          { name: 'height', return_type: [{ type: 'number', name: '' }] },
        ],
      },
    ];

    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [
          { name: 'split', return_type: [{ type: 'array', array_value: 'string' }] },
          { name: 'upcase', return_type: [{ type: 'string', name: '' }] },
          { name: 'downcase', return_type: [{ type: 'string', name: '' }] },
        ],
        objects: async () => _objects,
        liquidDrops: async () => _objects,
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      },
    });
  });

  it('does not complete number lookups', async () => {
    await expect(provider).to.complete('{{ global_with_items[01█ }}', []);
  });

  it('does not complete boolean lookups', async () => {
    await expect(provider).to.complete('{{ global_with_items[tr█ }}', []);
  });

  it('does complete string lookups', async () => {
    await expect(provider).to.complete('{{ global_with_items["█ }}', ['items']);
  });

  it('has nothing to complete for numbers', async () => {
    const sources = [
      `{% assign x = 10 %}
       {{ x.█ }}`,
      `{% for x in (0..5) %}
         {{ x.█ }}
       {% endfor %}`,
    ];
    for (const source of sources) {
      await expect(provider).to.complete(source, []);
    }
  });

  describe('Case: global variables', () => {
    it('returns the properties of global variables', async () => {
      await expect(provider).to.complete('{{ global_default.█ }}', ['prop1', 'prop2']);
      await expect(provider).to.complete('{{ global_access.█ }}', ['prop3', 'prop4']);
    });

    it('returns the properties of a global variable holding an array', async () => {
      await expect(provider).to.complete('{{ global_with_items.█ }}', ['items']);
    });

    it('does not complete the properties of a non-global type', async () => {
      await expect(provider).to.complete('{{ item_type.█ }}', []);
    });
  });

  describe('Case: scoping and inference', () => {
    it('returns the properties of a resolved variable', async () => {
      const source = `
        {% assign x = global_default %}
        {{ x.p█ }}
      `;
      await expect(provider).to.complete(source, ['prop1', 'prop2']);
    });

    it('returns the properties of the infered type of a deep lookup', async () => {
      const source = `
        {% assign x = global_with_items.items.first %}
        {{ x.s█ }}
      `;
      await expect(provider).to.complete(source, ['src']);
    });

    it('returns the properties of the infered type of a series of threaded types', async () => {
      const source = `
        {% assign x = global_with_items %}
        {% assign y = x.items %}
        {% assign z = y.first %}
        {{ z.s█ }}
      `;
      await expect(provider).to.complete(source, ['src']);
    });

    it('returns the properties of the infered type of a series of threaded types (liquid tag)', async () => {
      const source = `
        {% liquid
          assign x = global_with_items
          assign y = x.items
          assign z = y.first
          echo z.s█
        %}
      `;
      await expect(provider).to.complete(source, ['src']);
    });

    describe('When: inside a for/tablerow loop', () => {
      it('returns the properties of the array_value of the array', async () => {
        for (const tag of ['for', 'tablerow']) {
          const source = `
            {% # x is global_default %}
            {% assign x = global_default %}

            {% # x is item_type only in for loop %}
            {% ${tag} x in global_with_items.items %}
              {{ x.s█ }}
            {% end${tag} %}
          `;
          await expect(provider, source).to.complete(source, ['src']);
        }
      });
    });

    it('returns the properties of the last known type of a thing', async () => {
      const source = `
        {% # x is global_default %}
        {% assign x = global_default %}

        {% # x is item_type only in for loop %}
        {% for x in global_with_items.items %}
          {{ x.src }}
        {% endfor %}

        {% # x is still global_default %}
        {{ x.█ }}
      `;
      await expect(provider).to.complete(source, ['prop1', 'prop2']);
    });
  });

  describe('Case: capture', () => {
    it('returns the properties of a captured string', async () => {
      const source = `
        {% capture x %}
          ...
        {% endcapture %}
        {{ x.█ }}
      `;
      await expect(provider).to.complete(source, ['size']);
    });
  });

  describe('Case: array parent type', () => {
    it('returns the properties of a created array from filter', async () => {
      const source = `
        {% assign x = '123' | split: '' %}
        {{ x.█ }}
      `;
      await expect(provider).to.complete(source, ['first', 'last', 'size']);
    });

    it('returns the properties of the array_value', async () => {
      const sources = [
        `{% assign x = global_with_items.items %}
         {{ x.first.█ }}`,
        `{% assign x = global_with_items.items %}
         {{ x.last.█ }}`,
        `{% assign x = global_with_items.items %}
         {{ x[0].█ }}`,
        `{% assign x = global_with_items.items %}
         {{ x[1].█ }}`,
        `{% assign x = global_with_items.items %}
         {% assign lookup = 0 %}
         {{ x[lookup].█ }}`,
      ];
      for (const source of sources) {
        await expect(provider, source).to.complete(source, ['height', 'src', 'width']);
      }
    });
  });

  describe('Case: infered filter return type', () => {
    it('should return the properties of a string return type', async () => {
      const source = `
        {% assign x = global_with_items.items.first.src | upcase | downcase %}
        {{ x.█ }}
      `;
      await expect(provider).to.complete(source, ['size']);
    });

    it('should return the properties of an array return type', async () => {
      const source = `
        {% assign x = global_with_items.items.first.src | split: ',' %}
        {{ x.█ }}
      `;
      await expect(provider).to.complete(source, ['first', 'last', 'size']);
    });
  });

  describe('Case: parse_json filter with arrays', () => {
    it('should complete properties of array elements accessed by index', async () => {
      const source = `
        {% assign a = '[{"name": "foo"}, {"name": "bar"}]' | parse_json %}
        {{ a[0].█ }}
      `;
      await expect(provider).to.complete(source, ['name']);
    });

    it('should complete properties of array elements accessed with first/last', async () => {
      const sources = [
        `{% assign a = '[{"prop": 1}]' | parse_json %}
         {{ a.first.█ }}`,
        `{% assign a = '[{"prop": 1}]' | parse_json %}
         {{ a.last.█ }}`,
      ];
      for (const source of sources) {
        await expect(provider, source).to.complete(source, ['prop']);
      }
    });

    it('should complete properties of nested objects in arrays', async () => {
      const source = `
        {% assign a = '[{"user": {"id": 1, "name": "test"}}]' | parse_json %}
        {{ a[0].user.█ }}
      `;
      await expect(provider).to.complete(source, ['id', 'name']);
    });

    it('should complete array properties for JSON arrays', async () => {
      const source = `
        {% assign a = '[1, 2, 3]' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['first', 'last', 'size']);
    });

    /**
     * An array LITERAL whose elements do not all resolve. Its items are alternatives — a read
     * reaches one of them — and one of them here is a value nobody can see into, so nothing
     * can be claimed absent. What the elements that DID resolve name is still worth offering:
     * `row` may not be a hash with a `name`, but the other element certainly is.
     */
    it('should complete the known elements of an array literal with an unresolvable one', async () => {
      const source = `
        {% assign rows = [row, {"name": "a", "id": 1}] %}
        {{ rows.first.█ }}
      `;
      await expect(provider).to.complete(source, ['id', 'name']);
    });

    it('should work with to_hash filter', async () => {
      const source = `
        {% assign a = '{"key": "value"}' | to_hash %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['key']);
    });

    it('should complete properties added via hash_assign to parse_json object', async () => {
      const source = `
        {% assign a = '{}' | parse_json %}
        {% hash_assign a['key'] = 5 %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['key']);
    });

    it('should complete properties added via hash_assign to existing parse_json object', async () => {
      const source = `
        {% assign a = '{"existing": 1}' | parse_json %}
        {% hash_assign a['added'] = 2 %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['added', 'existing']);
    });

    it('should complete both levels of a nested hash_assign', async () => {
      const built = (read: string) => `
        {% assign a = '{}' | parse_json %}
        {% hash_assign a['nested'] = '{}' | parse_json %}
        {% hash_assign a['nested']['key'] = 5 %}
        ${read}
      `;

      await expect(provider).to.complete(built(`{{ a.█ }}`), ['nested']);
      await expect(provider).to.complete(built(`{{ a.nested.█ }}`), ['key']);
    });

    it('should merge shapes from all array elements', async () => {
      const source = `
        {% assign a = '[{"name": "foo"}, {"age": 30}, {"name": "bar", "city": "NYC"}]' | parse_json %}
        {{ a[0].█ }}
      `;
      await expect(provider).to.complete(source, ['age', 'city', 'name']);
    });

    /**
     * The standard platformOS "parse params with a default" idiom. The fallback is parsed
     * only when the expression is blank, so its keys are the value's keys in one branch and
     * nobody's in the other — and the analyzer says exactly that, as an OPEN shape whose
     * properties are all OPTIONAL.
     */
    it('should offer a default filter fallback keys, which one branch really has', async () => {
      const source = `
        {% assign a = some_var | default: '{"fallback": true, "value": 42}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['fallback', 'value']);
    });

    /**
     * The control, and the other side of the same rule: AFTER the parse, the value is a Hash
     * and `default`'s fallback is a plain String, so `'[]' | parse_json` being empty leaves
     * the variable holding the unparsed TEXT `{"b": 2}`. The analyzer claims no shape rather
     * than the array's — `UnknownProperty` used to report `b` here — and what is left is the
     * fallback's own type, a string, whose one member is the one a string really has.
     */
    it('should infer a string, not the parsed array, from a default that comes after the parse', async () => {
      const source = `
        {% assign a = '[]' | parse_json | default: '{"b": 2}' %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['size']);
    });

    it('should work with parse_json block syntax', async () => {
      const source = `
        {% parse_json data %}
          {"name": "test", "count": 5}
        {% endparse_json %}
        {{ data.█ }}
      `;
      await expect(provider).to.complete(source, ['count', 'name']);
    });

    it('should handle variable reassignment', async () => {
      const source = `
        {% assign a = '{"old": 1}' | parse_json %}
        {% assign a = '{"new": 2}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['new']);
    });

    it('should handle hash_assign without lookups (works like assign)', async () => {
      const source = `
        {% hash_assign a = '{"key": "value"}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['key']);
    });

    it('should handle hash_assign reassignment without lookups', async () => {
      const source = `
        {% assign a = '{"old": 1}' | parse_json %}
        {% hash_assign a = '{"new": 2}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['new']);
    });

    it('should handle parse_json block tag reassignment', async () => {
      const source = `
        {% assign a = '{"old": 1}' | parse_json %}
        {% parse_json a %}{"new": 2}{% endparse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, ['new']);
    });

    it('should include type information in completion detail', async () => {
      const source = `
        {% assign a = '{"name": "foo", "count": 5, "active": true, "items": [1, 2]}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, [
        expect.objectContaining({
          label: 'active',
          detail: 'Type: boolean',
          kind: CompletionItemKind.Property,
        }),
        expect.objectContaining({
          label: 'count',
          detail: 'Type: number',
          kind: CompletionItemKind.Property,
        }),
        expect.objectContaining({
          label: 'items',
          detail: 'Type: number[]',
          kind: CompletionItemKind.Property,
        }),
        expect.objectContaining({
          label: 'name',
          detail: 'Type: string',
          kind: CompletionItemKind.Property,
        }),
      ]);
    });

    it('should show object type with keys for nested objects', async () => {
      const source = `
        {% assign a = '{"user": {"id": 1, "name": "test"}}' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, [
        expect.objectContaining({
          label: 'user',
          detail: 'Type: object\nKeys: id, name',
          kind: CompletionItemKind.Property,
        }),
      ]);
    });

    it('should show correct type for array first/last accessors with item keys', async () => {
      const source = `
        {% assign a = '[{"name": "test", "id": 1}]' | parse_json %}
        {{ a.█ }}
      `;
      await expect(provider).to.complete(source, [
        expect.objectContaining({
          label: 'first',
          detail: 'Type: object\nKeys: name, id',
          kind: CompletionItemKind.Property,
        }),
        expect.objectContaining({
          label: 'last',
          detail: 'Type: object\nKeys: name, id',
          kind: CompletionItemKind.Property,
        }),
        expect.objectContaining({
          label: 'size',
          detail: 'Type: number',
          kind: CompletionItemKind.Property,
        }),
      ]);
    });

    it('should truncate keys when there are many', async () => {
      const source = `
        {% assign a = '{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7}' | parse_json %}
        {{ a.█ }}
      `;
      // Check that one of the completions has truncated keys
      await expect(provider).to.complete(
        source,
        expect.arrayContaining([
          expect.objectContaining({
            label: 'a',
            detail: 'Type: number',
          }),
        ]),
      );
    });

    it('should complete properties when referencing variable in its own reassignment', async () => {
      const source = `
        {% assign a = '{"foo": 1, "bar": 2}' | parse_json %}
        {% assign a = a.█ %}
      `;
      await expect(provider).to.complete(source, ['bar', 'foo']);
    });

    it('should complete nested properties in self-referential assignment', async () => {
      const source = `
        {% assign a = '{"nested": {"deep": 1}}' | parse_json %}
        {% assign b = a.nested.█ %}
      `;
      await expect(provider).to.complete(source, ['deep']);
    });
  });
});
