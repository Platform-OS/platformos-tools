import { describe, it, expect } from 'vitest';
import { generateParamLine, generateDocTag } from './doc-generator';

describe('Module: doc-generator', () => {
  describe('Unit: generateParamLine', () => {
    it('generates optional param line with brackets', () => {
      const line = generateParamLine('name', 'string', true);
      expect(line).toBe('@param {string} [name]');
    });

    it('generates required param line without brackets', () => {
      const line = generateParamLine('count', 'number', false);
      expect(line).toBe('@param {number} count');
    });

    it('handles all basic param types', () => {
      expect(generateParamLine('a', 'string')).toBe('@param {string} [a]');
      expect(generateParamLine('b', 'number')).toBe('@param {number} [b]');
      expect(generateParamLine('c', 'boolean')).toBe('@param {boolean} [c]');
      expect(generateParamLine('d', 'object')).toBe('@param {object} [d]');
    });
  });

  describe('Unit: generateDocTag', () => {
    it('generates empty doc tag when no params', () => {
      const tag = generateDocTag([]);
      expect(tag).toBe('{% doc %}\n{% enddoc %}\n');
    });

    it('generates doc tag with single param', () => {
      const tag = generateDocTag(['@param {string} [name]']);
      expect(tag).toBe('{% doc %}\n  @param {string} [name]\n{% enddoc %}\n');
    });

    it('generates doc tag with multiple params', () => {
      const tag = generateDocTag(['@param {string} [name]', '@param {number} [count]']);
      expect(tag).toBe(
        '{% doc %}\n  @param {string} [name]\n  @param {number} [count]\n{% enddoc %}\n',
      );
    });

    it('uses custom indentation', () => {
      const tag = generateDocTag(['@param {string} [name]'], '    ');
      expect(tag).toBe('{% doc %}\n    @param {string} [name]\n{% enddoc %}\n');
    });
  });
});
