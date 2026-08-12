import { describe, it, expect } from 'vitest';
import { FilterEntry } from './types';
import {
  docsetParameterType,
  docsetReturnType,
  filterChainType,
  filterReturnTypes,
} from './liquid-types';

/**
 * Every entry below is declared HERE, as INPUT. Nothing in this file asserts what the shipped
 * `filters.json` says — that is settled where the docset is authored, and restating it would fail
 * on a docs release that is perfectly correct.
 */
const entry = (name: string, ...types: string[]): FilterEntry => ({
  name,
  return_type: types.map((type) => ({ type, name: '' })),
});

describe('docsetReturnType', () => {
  it('resolves the published spellings', () => {
    const resolved = ['string', 'number', 'boolean', 'array', 'object', 'date', 'time'].map(
      (type) => docsetReturnType(entry('f', type)),
    );

    expect(resolved).toEqual(['string', 'number', 'boolean', 'array', 'object', 'date', 'time']);
  });

  it('resolves the legacy spellings a cached docset may still carry', () => {
    const resolved = ['hash', 'datetime', 'array of arrays'].map((type) =>
      docsetReturnType(entry('f', type)),
    );

    expect(resolved).toEqual(['object', 'time', 'array']);
  });

  it('is untyped for anything it cannot place', () => {
    const resolved = [
      docsetReturnType(entry('no_types')),
      docsetReturnType({ name: 'no_field' }),
      docsetReturnType(entry('unknown_spelling', 'chronomancer')),
      docsetReturnType(entry('explicitly_untyped', 'untyped')),
      docsetReturnType(entry('input_dependent', 'string, nil')),
    ];

    expect(resolved).toEqual(['untyped', 'untyped', 'untyped', 'untyped', 'untyped']);
  });

  it('resolves a multi-branch return type only when every branch agrees', () => {
    expect(docsetReturnType(entry('agrees', 'string', 'string'))).toEqual('string');
    expect(docsetReturnType(entry('disagrees', 'string', 'number'))).toEqual('untyped');
    // One unplaceable branch poisons the union — a "string or something" is not a string for a
    // check that refuses working code on the answer.
    expect(docsetReturnType(entry('half_known', 'string', 'chronomancer'))).toEqual('untyped');
  });
});

describe('filterReturnTypes', () => {
  it('indexes by name, omitting the filters it cannot type', () => {
    const map = filterReturnTypes([
      entry('append', 'string'),
      entry('plus', 'number'),
      entry('mystery'),
    ]);

    expect([...map]).toEqual([
      ['append', 'string'],
      ['plus', 'number'],
    ]);
  });

  it('returns the same map for the same docset array, and a fresh one for another', () => {
    const filters = [entry('append', 'string')];

    expect(filterReturnTypes(filters)).toBe(filterReturnTypes(filters));
    expect(filterReturnTypes(filters)).not.toBe(filterReturnTypes([entry('append', 'string')]));
  });
});

describe('filterChainType', () => {
  const types = filterReturnTypes([entry('append', 'string'), entry('plus', 'number')]);

  it('takes the type of the LAST filter, since every earlier one is input to the next', () => {
    expect(filterChainType([{ name: 'plus' }, { name: 'append' }], types)).toEqual('string');
    expect(filterChainType([{ name: 'append' }, { name: 'plus' }], types)).toEqual('number');
  });

  it('is untyped when the last filter is unknown, whatever the earlier ones resolve to', () => {
    expect(filterChainType([{ name: 'append' }, { name: 'not_a_filter' }], types)).toEqual(
      'untyped',
    );
  });

  it('is untyped with no filters and with no map', () => {
    expect(filterChainType([], types)).toEqual('untyped');
    expect(filterChainType([{ name: 'append' }], undefined)).toEqual('untyped');
  });
});

describe('docsetParameterType', () => {
  it('resolves what a published argument type names, and nothing else', () => {
    expect({
      published: docsetParameterType({ types: ['number'] }),
      legacy: docsetParameterType({ types: ['hash'] }),
      explicitlyUntyped: docsetParameterType({ types: ['untyped'] }),
      unplaceable: docsetParameterType({ types: ['Liquid::Context'] }),
      empty: docsetParameterType({ types: [] }),
      union: docsetParameterType({ types: ['string', 'number'] }),
      agreeingUnion: docsetParameterType({ types: ['string', 'string'] }),
    }).toEqual({
      published: 'number',
      legacy: 'object',
      explicitlyUntyped: 'untyped',
      unplaceable: 'untyped',
      empty: 'untyped',
      union: 'untyped',
      agreeingUnion: 'string',
    });
  });
});

describe("a TAG's return type", () => {
  /**
   * 33 of the 56 shipped tags carry `return_type`, and it is an EMPTY ARRAY in every one. That is
   * "the documentation does not say", never "this tag returns nothing" — the same reading a filter
   * with no `return_type` gets, through the same function, so the two cannot drift apart.
   */
  it('is untyped when the docset publishes an empty array', () => {
    expect({
      empty: docsetReturnType({ name: 'for', return_type: [] }),
      absent: docsetReturnType({ name: 'assign' }),
    }).toEqual({ empty: 'untyped', absent: 'untyped' });
  });
});
