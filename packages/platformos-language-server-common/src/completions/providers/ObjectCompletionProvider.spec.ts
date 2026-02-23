import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { CompletionsProvider } from '../CompletionsProvider';
import { ObjectEntry } from '@platformos/platformos-check-common';

describe('Module: ObjectCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    const _objects: ObjectEntry[] = [
      {
        name: 'context',
        access: { global: true, parents: [], template: [] },
        properties: [
          { name: 'current_user', return_type: [{ type: 'current_user', name: '' }] },
          { name: 'params', return_type: [{ type: 'untyped', name: '' }] },
        ],
      },
      { name: 'global' },
      {
        name: 'form',
        access: {
          global: false,
          template: [],
          parents: [],
        },
      },
      {
        name: 'app',
        access: {
          global: false,
          template: [],
          parents: [],
        },
      },
      {
        name: 'current_user',
        access: { global: false, parents: [], template: [] },
        properties: [{ name: 'name' }, { name: 'email' }],
      },
    ];

    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => _objects,
        liquidDrops: async () => _objects,
        tags: async () => [],
      },
    });
  });

  it('should complete variable lookups', async () => {
    const contexts = [
      `{{ c█`,
      `{% echo c█ %}`,
      `{% assign x = c█ %}`,
      `{% for a in c█ %}`,
      `{% for a in b reversed limit: c█ %}`,
      `{% if c█ %}`,
      `{% if a > c█ %}`,
      `{% if a > b or c█ %}`,
      `{% for x in (1..c█) %}`,
      `<a-{{ c█ }}`,
      `<a data-{{ c█ }}`,
      `<a data={{ c█ }}`,
      `<a data="{{ c█ }}"`,
      `<a data='x{{ c█ }}'`,
    ];
    await Promise.all(
      contexts.map((context) => expect(provider, context).to.complete(context, ['context'])),
    );
  });

  it('should complete variable lookups (placeholder mode)', async () => {
    const contexts = [
      `{{ █`,
      `{% echo █ %}`,
      `{% assign x = █ %}`,
      `{% for a in █ %}`,
      `{% for a in b reversed limit: █ %}`,
      `{% if █ %}`,
      `{% if a > █ %}`,
      `{% if a > b or █ %}`,
      `{% if a > b or c > █ %}`,
      `{% elsif a > █ %}`,
      `{% when █ %}`,
      `{% when a, █ %}`,
      `{% cycle █ %}`,
      `{% cycle 'foo', █ %}`,
      `{% cycle 'foo': █ %}`,
      `{% render 'snip', var: █ %}`,
      `{% render 'snip' for █ as item %}`,
      `{% render 'snip' with █ as name %}`,
      `{% for x in (1..█) %}`,
      `<a-{{ █ }}`,
      `<a data-{{ █ }}`,
      `<a data={{ █ }}`,
      `<a data="{{ █ }}"`,
      `<a data='x{{ █ }}'`,
    ];

    await Promise.all(
      contexts.map((context) =>
        expect(provider, context).to.complete(context, ['context', 'global']),
      ),
    );
  });

  it('should complete contextual variables', async () => {
    const contexts: [string, string][] = [
      ['{% for p in context.posts %}{{ for█ }}{% endfor %}', 'forloop'],
      ['{% tablerow p in context.posts %}{{ tablerow█ }}{% endtablerow %}', 'tablerowloop'],
      ['{% layout non█ %}', 'none'],
      ['{% increment var %}{{ var█ }}', 'var'],
      ['{% decrement var %}{{ var█ }}', 'var'],
      ['{% assign var = 1 %}{{ var█ }}', 'var'],
    ];
    for (const [context, expected] of contexts) {
      await expect(provider, context).to.complete(context, [expected]);
      const outOfContext = `{{ ${expected}█ }}`;
      await expect(provider, outOfContext).to.complete(outOfContext, []);
    }
  });

  it('should complete relative-path-dependent contextual variables', async () => {
    const contexts: [string, string][] = [
      ['app', 'app/views/partials/my-partial.liquid'],
      ['app', 'app/lib/helpers/my-helper.liquid'],
    ];
    for (const [object, relativePath] of contexts) {
      const source = `{{ ${object}█ }}`;
      await expect(provider, source).to.complete({ source, relativePath }, [object]);
      await expect(provider, source).to.complete({ source, relativePath: 'file.liquid' }, []);
    }
  });

  it('should not complete anything if there is nothing to complete', async () => {
    await expect(provider).to.complete('{% assign x = "█" %}', []);
  });
});
