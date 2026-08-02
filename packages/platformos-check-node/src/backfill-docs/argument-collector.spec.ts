import { describe, it, expect } from 'vitest';
import { sourceParsers } from '@platformos/platformos-check-common';
import { AbstractFileSystem, App } from '@platformos/platformos-common';
import { collectPartialUsages } from './argument-collector';

const ROOT = 'file:///';

/** Nothing here reads: `App.fromSources` starts every file loaded. */
const NO_READS = {
  readFile: async (uri: string) => {
    throw new Error(`unexpected read of ${uri}`);
  },
  readDirectory: async () => {
    throw new Error('unexpected readDirectory');
  },
  stat: async () => {
    throw new Error('unexpected stat');
  },
} satisfies AbstractFileSystem;

const appOf = (sources: Record<string, string>) =>
  App.fromSources(ROOT, sources, NO_READS, sourceParsers);

describe('Module: argument-collector', () => {
  describe('Unit: collectPartialUsages', () => {
    it('collects arguments from function tags', async () => {
      const source = `{% function result = 'my_partial', name: 'test', count: 42 %}`;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      expect(usages.size).toBe(1);
      const usage = usages.get('function:my_partial');
      expect(usage).toBeDefined();
      expect(usage?.tagType).toBe('function');
      expect(usage?.partialPath).toBe('my_partial');
      expect(usage?.arguments.size).toBe(2);
      expect(usage?.arguments.get('name')?.inferredType).toBe('string');
      expect(usage?.arguments.get('count')?.inferredType).toBe('number');
    });

    it('collects arguments from render tags', async () => {
      const source = `{% render 'my_partial', title: 'Hello', active: true %}`;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      expect(usages.size).toBe(1);
      const usage = usages.get('render:my_partial');
      expect(usage).toBeDefined();
      expect(usage?.tagType).toBe('render');
      expect(usage?.arguments.get('title')?.inferredType).toBe('string');
      expect(usage?.arguments.get('active')?.inferredType).toBe('boolean');
    });

    it('collects arguments from include tags', async () => {
      const source = `{% include 'legacy_partial', value: someVar %}`;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      expect(usages.size).toBe(1);
      const usage = usages.get('include:legacy_partial');
      expect(usage).toBeDefined();
      expect(usage?.tagType).toBe('include');
      expect(usage?.arguments.get('value')?.inferredType).toBe('object');
    });

    it('merges arguments from multiple calls to the same partial', async () => {
      const source = `
        {% function result = 'calc', a: 1 %}
        {% function result = 'calc', b: 2 %}
        {% function result = 'calc', a: 3 %}
      `;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      const usage = usages.get('function:calc');
      expect(usage?.arguments.size).toBe(2);
      expect(usage?.arguments.get('a')?.usageCount).toBe(2);
      expect(usage?.arguments.get('b')?.usageCount).toBe(1);
    });

    it('resolves conflicting types to object', async () => {
      const source = `
        {% function result = 'flex', value: 'string' %}
        {% function result = 'flex', value: 123 %}
      `;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      const usage = usages.get('function:flex');
      expect(usage?.arguments.get('value')?.inferredType).toBe('object');
    });

    it('skips dynamic partial paths', async () => {
      const source = `{% render partial_name, arg: 'value' %}`;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      expect(usages.size).toBe(0);
    });

    it('handles multiple files', async () => {
      const app = appOf({
        'app/views/partials/a.liquid': `{% function r = 'shared', from_a: 1 %}`,
        'app/views/partials/b.liquid': `{% function r = 'shared', from_b: 2 %}`,
      });

      const usages = await collectPartialUsages(app);

      const usage = usages.get('function:shared');
      expect(usage?.arguments.size).toBe(2);
      expect(usage?.arguments.has('from_a')).toBe(true);
      expect(usage?.arguments.has('from_b')).toBe(true);
    });

    it('separates function and render usages of same path', async () => {
      const source = `
        {% function r = 'partial', func_arg: 1 %}
        {% render 'partial', render_arg: 2 %}
      `;
      const app = appOf({ 'app/views/partials/test.liquid': source });

      const usages = await collectPartialUsages(app);

      expect(usages.size).toBe(2);
      expect(usages.has('function:partial')).toBe(true);
      expect(usages.has('render:partial')).toBe(true);
    });
  });
});
