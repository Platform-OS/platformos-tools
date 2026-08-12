import { describe, expect, it } from 'vitest';

import { acceptsArgumentCount, filterArities, resolveArity } from './filter-arity-lookup';
import type { FilterEntry } from './types';

const arityOf = (name: string, entries: FilterEntry[]) =>
  resolveArity(name, filterArities(entries));

describe('Module: filter-arity-lookup', () => {
  // `max: null` claims variadic, so an absent `max` must not be read as one. This is the only
  // validation of the published field.
  describe('an arity the docset published incompletely', () => {
    it('ignores a row whose max is missing, rather than reading it as variadic', async () => {
      // The explicit `max: null` beside it is the control that the claim IS honoured when made.
      expect({
        incomplete: arityOf('upcase', [{ name: 'upcase', arity: { min: 1 } } as FilterEntry]),
        explicitlyVariadic: arityOf('upcase', [{ name: 'upcase', arity: { min: 1, max: null } }]),
      }).toEqual({
        incomplete: undefined,
        explicitlyVariadic: { min: 1, max: null },
      });
    });

    it('ignores a row whose min is missing or not a number', async () => {
      // A filter the generator has no signature for is published as `{ min: null, max: null }`.
      expect({
        nullBoth: arityOf('upcase', [{ name: 'upcase', arity: { min: null, max: null } } as any]),
        stringMin: arityOf('upcase', [{ name: 'upcase', arity: { min: '1', max: 1 } } as any]),
        complete: arityOf('upcase', [{ name: 'upcase', arity: { min: 1, max: 3 } }]),
      }).toEqual({
        // `complete` is the control that a well-formed row IS taken.
        nullBoth: undefined,
        stringMin: undefined,
        complete: { min: 1, max: 3 },
      });
    });
  });

  describe('resolveArity', () => {
    it('answers from the docset, and answers nothing when the docset is silent', async () => {
      // A bare name and an unknown name are both "nothing known", which for a blocking check must
      // mean unchecked rather than a guessed bound.
      expect({
        docset: arityOf('upcase', [{ name: 'upcase', arity: { min: 1, max: 9 } }]),
        bareName: arityOf('upcase', [{ name: 'upcase' }]),
        unknown: arityOf('some_module_filter', [{ name: 'some_module_filter' }]),
      }).toEqual({
        docset: { min: 1, max: 9 },
        bareName: undefined,
        unknown: undefined,
      });
    });

    it('answers nothing for a name only Object.prototype knows', async () => {
      // A lookup built on an object literal reaches the prototype and answers these with functions.
      expect(
        ['constructor', 'toString', 'valueOf', 'hasOwnProperty'].map((name) =>
          arityOf(name, [{ name: 'upcase', arity: { min: 1, max: 1 } }]),
        ),
      ).toEqual([undefined, undefined, undefined, undefined]);
    });
  });

  describe('acceptsArgumentCount', () => {
    it('treats a null max as unbounded and still enforces the minimum', async () => {
      const variadic = { min: 2, max: null };
      const bounded = { min: 2, max: 3 };

      expect({
        variadicTooFew: acceptsArgumentCount(variadic, 1),
        variadicAtMin: acceptsArgumentCount(variadic, 2),
        variadicFar: acceptsArgumentCount(variadic, 40),
        boundedAtMax: acceptsArgumentCount(bounded, 3),
        boundedOver: acceptsArgumentCount(bounded, 4),
      }).toEqual({
        variadicTooFew: false,
        variadicAtMin: true,
        variadicFar: true,
        boundedAtMax: true,
        boundedOver: false,
      });
    });
  });
});
