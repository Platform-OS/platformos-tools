import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { ObjectEntry } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('Module: LiquidObjectHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    const _objects: ObjectEntry[] = [
      {
        name: 'context',
        description: 'context description',
        access: { global: true, parents: [], template: [] },
        return_type: [],
        properties: [
          {
            name: 'posts',
            return_type: [{ type: 'array', array_value: 'post' }],
          },
          {
            name: 'current_user',
            return_type: [{ type: 'current_user', name: '' }],
          },
        ],
      },
      {
        name: 'post',
        description: 'post description',
        return_type: [],
        properties: [
          {
            name: 'thumbnail',
            return_type: [{ type: 'image', name: '' }],
          },
          {
            name: 'title',
            return_type: [{ type: 'string', name: '' }],
          },
          { name: 'metadata' },
        ],
      },
      {
        name: 'forloop',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'tablerowloop',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'image',
        description: 'image description',
        access: { global: false, parents: [], template: [] },
      },
      {
        name: 'app',
        access: { global: false, parents: [], template: [] },
      },
    ];

    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => _objects,
        liquidDrops: async () => _objects,
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      new TranslationProvider(new MockFileSystem({})),
    );
  });

  it('should return the hover description of the global object', async () => {
    const contexts = [
      '{{ con█text }}',
      '{{ context█ }}',
      '{% echo context█ %}',
      '{% liquid\n echo context█ %}',
      '{% assign x = context %}{{ x█ }}',
    ];
    for (const context of contexts) {
      await expect(provider).to.hover(context, expect.stringContaining('context description'));
      await expect(provider).to.hover(context, expect.stringMatching(/##* \w+: `context`/));
    }
  });

  it('should return the hover description of an array item object', async () => {
    const contexts = [
      '{% for x in context.posts %}{{ x█ }}{% endfor %}',
      '{% assign x = context.posts[0] %}{{ x█ }}',
      '{% assign x█ = context.posts[0] %}',
      // '{% for x█ in context.posts %}{{ x }}{% endfor %}', // not supported yet...
    ];
    for (const context of contexts) {
      await expect(provider).to.hover(context, expect.stringContaining('post description'));
      await expect(provider).to.hover(context, expect.stringMatching(/##* \w+: `post`/));
    }
  });

  it('should support forloop inside for tags', async () => {
    const context = `
      {% for p in context.posts %}
        {{ forloop█ }}
      {% endfor %}
    `;
    await expect(provider).to.hover(context, expect.stringMatching(/##* forloop: `forloop`/));
    await expect(provider).to.hover('{{ forloop█ }}', null);
  });

  it('should support tablerowloop inside tablerow tags', async () => {
    const context = `
      {% tablerow p in context.posts %}
        {{ tablerowloop█ }}
      {% endtablerow %}
    `;
    await expect(provider).to.hover(
      context,
      expect.stringMatching(/##* tablerowloop: `tablerowloop`/),
    );
    await expect(provider).to.hover('{{ tablerowloop█ }}', null);
  });

  it('should support {% layout none %}', async () => {
    await expect(provider).to.hover(
      `{% layout none█ %}`,
      expect.stringMatching(/##* none: `keyword`/),
    );
    await expect(provider).to.hover('{{ none█ }}', null);
  });

  it('should support {% increment var %}', async () => {
    await expect(provider).to.hover(
      `{% increment var█ %}`,
      expect.stringMatching(/##* var: `number`/),
    );
    await expect(provider).to.hover('{{ var█ }}', null);
  });

  it('should support {% decrement var %}', async () => {
    await expect(provider).to.hover(
      `{% decrement var█ %}`,
      expect.stringMatching(/##* var: `number`/),
    );
    await expect(provider).to.hover('{{ var█ }}', null);
  });

  it('should support contextual objects by relative path', async () => {
    const contexts: [string, string][] = [
      ['app', 'app/views/partials/recommendations.liquid'],
      ['app', 'app/lib/helpers/my-helper.liquid'],
    ];
    for (const [object, relativePath] of contexts) {
      const source = `{{ ${object}█ }}`;
      await expect(provider).to.hover(
        { source, relativePath },
        expect.stringContaining(`## ${object}`),
      );
      await expect(provider).to.hover({ source, relativePath: 'file.liquid' }, null);
    }
  });

  it('should return null when hovering over an undefined variable', async () => {
    await expect(provider).to.hover(`{{ unknown█ }}`, null);
  });

  it('should return something if the thing is knowingly untyped', async () => {
    await expect(provider).to.hover(
      `{% assign src = context.posts[0].thumbnail.src %}{{ src█ }}`,
      `### src: \`untyped\``,
    );
  });

  it('should still return null when hovering over an unknown variable out of scope', async () => {
    await expect(provider).to.hover(
      `{% for p in context.posts %}
        {{ forloop█ }}
      {% endfor %}
      {{ forloop }}`,
      expect.stringMatching(/##* forloop: `forloop`/),
    );
    await expect(provider).to.hover(
      `{% for p in context.posts %}
        {{ forloop }}
      {% endfor %}
      {{ forloop█ }}`,
      null,
    );
  });
});
