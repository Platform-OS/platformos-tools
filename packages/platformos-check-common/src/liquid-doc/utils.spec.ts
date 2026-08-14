import { describe, expect, it } from 'vitest';
import { declarableParamType, getValidParamTypes, parseParamType } from './utils';
import { NO_LIQUID_DOC } from '../test/mock-docset';
import { publishedLiquidDoc } from '../test/published-docset';

describe('liquid-doc/utils', () => {
  describe('parseParamType', () => {
    // The REAL published types, plus one real object name: this test is about the SPELLING
    // `parseParamType` accepts, and which names exist is the docset's to decide.
    const validParamTypes = new Set<string>([
      ...publishedLiquidDoc.param_types.map((type) => type.name),
      'current_user',
    ]);

    it('should parse all values provided in the `validParamTypes` set', () => {
      const tests = {
        string: ['string', false],
        current_user: ['current_user', false],
        'string[]': ['string', true],
        'current_user[]': ['current_user', true],
        invalid: undefined,
      };

      Object.entries(tests).forEach(([input, expected]) => {
        const result = parseParamType(validParamTypes, input);
        expect(result).toEqual(expected);
      });
    });
  });

  describe('getValidParamTypes', () => {
    const drops = [
      { name: 'current_user', summary: 'The signed-in user' },
      { name: 'page', description: 'The current page' },
    ];

    it('unions the published types with the objects a value can be an instance of', () => {
      const types = getValidParamTypes(publishedLiquidDoc.param_types, drops);

      expect([...types!]).toEqual([
        ...publishedLiquidDoc.param_types.map(({ name, description }) => [name, description]),
        ['current_user', 'The signed-in user'],
        ['page', 'The current page'],
      ]);
    });

    /**
     * `undefined`, NOT an empty map, when the vocabulary is unpublished — the two answers mean opposite
     * things to a caller. An empty set of valid types would make every `@param {string}` in a project an
     * offense; `undefined` is what makes each caller decide what "the docset does not say" means.
     */
    it('answers undefined when the docset publishes no types', () => {
      expect(getValidParamTypes(NO_LIQUID_DOC.param_types, drops)).toBeUndefined();
    });

    /** THE CONTROL: the same drops DO reach the map when the published half is there. */
    it('is not the drops alone', () => {
      const types = getValidParamTypes(publishedLiquidDoc.param_types, drops);

      expect([types!.has('current_user'), types!.has('string')]).toEqual([true, true]);
    });
  });

  describe('declarableParamType', () => {
    /**
     * The narrowing `backfill-docs` writes into a user's file. `date` and `time` survive it now — they
     * are types the platform publishes and an author may declare — while the two that no docblock can
     * spell land on the documented generic.
     */
    it('keeps every type an author could have written and generalises the rest', () => {
      const narrowed = (['string', 'number', 'boolean', 'array', 'date', 'time'] as const).map(
        declarableParamType,
      );

      expect(narrowed).toEqual(['string', 'number', 'boolean', 'array', 'date', 'time']);
      expect([
        declarableParamType('untyped'),
        declarableParamType('null'),
        declarableParamType('range'),
        declarableParamType('object'),
      ]).toEqual(['object', 'object', 'object', 'object']);
    });
  });
});
