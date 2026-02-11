import { describe, it, expect } from 'vitest';
import { updateDocInSource, getExistingParams } from './doc-updater';

describe('Module: doc-updater', () => {
  describe('Unit: getExistingParams', () => {
    it('returns empty array when no doc tag', async () => {
      const source = `<div>{{ content }}</div>`;
      const params = await getExistingParams(source);
      expect(params).toEqual([]);
    });

    it('extracts existing params from doc tag', async () => {
      const source = `{% doc %}
  @param {string} name - The name
  @param {number} count
{% enddoc %}
<div>{{ name }}</div>`;
      const params = await getExistingParams(source);

      expect(params).toHaveLength(2);
      expect(params[0].name).toBe('name');
      expect(params[0].type).toBe('string');
      expect(params[0].description).toBe('The name');
      expect(params[1].name).toBe('count');
      expect(params[1].type).toBe('number');
      expect(params[1].description).toBeNull();
    });

    it('handles required params', async () => {
      const source = `{% doc %}
  @param {string} required_param
  @param {string} [optional_param]
{% enddoc %}`;
      const params = await getExistingParams(source);

      expect(params[0].required).toBe(true);
      expect(params[1].required).toBe(false);
    });
  });

  describe('Unit: updateDocInSource', () => {
    it('returns null when no params to add', async () => {
      const source = `<div>content</div>`;
      const result = await updateDocInSource(source, []);
      expect(result).toBeNull();
    });

    it('creates new doc tag at start of file when none exists', async () => {
      const source = `<div>{{ name }}</div>`;
      const result = await updateDocInSource(source, ['@param {string} [name]']);

      expect(result).toBe(`{% doc %}
  @param {string} [name]
{% enddoc %}
<div>{{ name }}</div>`);
    });

    it('adds multiple params to new doc tag', async () => {
      const source = `content`;
      const result = await updateDocInSource(source, [
        '@param {string} [a]',
        '@param {number} [b]',
      ]);

      expect(result).toContain('@param {string} [a]');
      expect(result).toContain('@param {number} [b]');
      expect(result).toContain('{% doc %}');
      expect(result).toContain('{% enddoc %}');
    });

    it('inserts new params after existing params in doc tag', async () => {
      const source = `{% doc %}
  @param {string} existing - Already documented
{% enddoc %}
<div>{{ existing }}</div>`;

      const result = await updateDocInSource(source, ['@param {number} [newParam]']);

      expect(result).toContain('@param {string} existing - Already documented');
      expect(result).toContain('@param {number} [newParam]');
      // Existing param should come before new one
      expect(result!.indexOf('existing')).toBeLessThan(result!.indexOf('newParam'));
    });

    it('does not add params that already exist', async () => {
      const source = `{% doc %}
  @param {string} name - The name
{% enddoc %}`;

      const result = await updateDocInSource(source, ['@param {string} [name]']);

      expect(result).toBeNull();
    });

    it('only adds new params that do not exist', async () => {
      const source = `{% doc %}
  @param {string} existing
{% enddoc %}`;

      const result = await updateDocInSource(source, [
        '@param {string} [existing]', // Should be skipped
        '@param {number} [newParam]', // Should be added
      ]);

      expect(result).not.toBeNull();
      expect(result).toContain('@param {string} existing');
      expect(result).toContain('@param {number} [newParam]');
      // Should only have one 'existing' param
      const existingMatches = result!.match(/@param.*existing/g);
      expect(existingMatches).toHaveLength(1);
    });

    it('preserves existing param descriptions', async () => {
      const source = `{% doc %}
  @param {string} name - The user's full name
{% enddoc %}`;

      const result = await updateDocInSource(source, ['@param {number} [age]']);

      expect(result).toContain("@param {string} name - The user's full name");
    });

    it('uses same indentation as existing params', async () => {
      const source = `{% doc %}
    @param {string} existing
{% enddoc %}`;

      const result = await updateDocInSource(source, ['@param {number} [newParam]']);

      // Should detect 4-space indentation
      expect(result).toContain('    @param {number} [newParam]');
    });
  });
});
