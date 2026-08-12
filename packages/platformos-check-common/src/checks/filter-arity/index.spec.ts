import { describe, expect, it } from 'vitest';

import { FilterArity } from './index';
import { check, MockApp } from '../../test';
import { FilterEntry, PlatformOSDocset } from '../../types';

/** A docset that publishes `arity`, which is what documentation.platformos.com now serves. */
const docsetWith = (filters: FilterEntry[]): Partial<{ platformosDocset: PlatformOSDocset }> => ({
  platformosDocset: {
    async filters() {
      return filters;
    },
    async objects() {
      return [];
    },
    async tags() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async liquidDoc() {
      return { annotations: [], param_types: [] };
    },
    async graphQL() {
      return null;
    },
  } as PlatformOSDocset,
});

/**
 * TASK-28 (evaluation finding F-07). A KNOWN filter called with the wrong number of
 * arguments used to pass validation and then raise at render time:
 *
 *   {{ 'abc' | slice }}   ->  ok / must_fix_before_write: false
 *                             Liquid::ArgumentError — wrong number of arguments
 *                             (given 1, expected 2..3), page HTTP 500
 *
 * The asymmetry was the finding: an unknown filter NAME blocked the write while a
 * known filter called wrongly — the same class of runtime failure — was approved.
 *
 * Every expected range below is the range the platform publishes, derived from the Ruby signature.
 * The docset is the only source, so these fixtures carry the arity the way the real data does.
 */
const PUBLISHED: FilterEntry[] = [
  { name: 'slice', arity: { min: 2, max: 3 } },
  { name: 'upcase', arity: { min: 1, max: 1 } },
  { name: 'replace', arity: { min: 2, max: 3 } },
  { name: 'append', arity: { min: 2, max: 2 } },
  { name: 'truncate', arity: { min: 1, max: 3 } },
  { name: 'sum', arity: { min: 1, max: 2 } },
  { name: 'split', arity: { min: 2, max: 2 } },
  { name: 'add_to_time', arity: { min: 1, max: 3 } },
  { name: 't', arity: { min: 1, max: 2 } },
  // Variadic: a splat has no upper bound, so `max` is null — "cannot refuse an argument".
  { name: 'dig', arity: { min: 1, max: null } },
  // A name the docset carries with no arity, like a module-provided filter.
  { name: 'some_module_filter' },
];

const offensesFor = (liquid: string) => {
  const app: MockApp = { 'app/views/partials/file.liquid': liquid };
  return check(app, [FilterArity], docsetWith(PUBLISHED));
};

const messages = async (liquid: string) =>
  (await offensesFor(liquid)).map((offense) => offense.message);

describe('Module: FilterArity', () => {
  describe('reports a call the runtime would reject', () => {
    it('reports too few arguments', async () => {
      // slice is 2..3; the piped value alone is 1.
      expect(await messages(`{{ 'abc' | slice }}`)).toEqual([
        "Filter 'slice' is called with 1 argument but accepts 2 to 3 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('reports too many arguments', async () => {
      // upcase is exactly 1, so any explicit argument is one too many.
      expect(await messages(`{{ 'abc' | upcase: 1, 2, 3 }}`)).toEqual([
        "Filter 'upcase' is called with 4 arguments but accepts exactly 1 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('reports the other filter named in the evaluation', async () => {
      expect(await messages(`{{ 'abc' | replace }}`)).toEqual([
        "Filter 'replace' is called with 1 argument but accepts 2 to 3 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('reports each offending filter in a chain independently', async () => {
      expect(await messages(`{{ 'abc' | slice | replace }}`)).toHaveLength(2);
    });
  });

  describe('counts arguments the way the runtime does', () => {
    it('treats a whole group of named arguments as ONE argument', async () => {
      // MEASURED: `{{ 'abc' | upcase: a: 1, b: 2, c: 3 }}` is "given 2", not 4.
      // Counting the three names separately would report this as 4 and refuse a
      // pattern the runtime merely type-errors on — the single most likely way for
      // this check to become a source of false blocks.
      expect(await messages(`{{ 'abc' | upcase: a: 1, b: 2, c: 3 }}`)).toEqual([
        "Filter 'upcase' is called with 2 arguments but accepts exactly 1 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('mixes positional and named arguments the way the runtime does', async () => {
      // MEASURED: `{{ 'abcdef' | slice: 1, 2, extra: 9 }}` is "given 4" — input + two
      // positional + one hash — which is one past slice's maximum of 3.
      expect(await messages(`{{ 'abcdef' | slice: 1, 2, extra: 9 }}`)).toEqual([
        "Filter 'slice' is called with 4 arguments but accepts 2 to 3 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('counts the piped value as argument one', async () => {
      // slice's minimum of 2 is satisfied by the input plus ONE explicit argument.
      // If the input were not counted this would read as 1 and be reported.
      expect(await messages(`{{ 'abcdef' | slice: 1 }}`)).toEqual([]);
    });
  });

  describe('stays silent where it cannot be sure', () => {
    it('says nothing about a filter the docset publishes no arity for', async () => {
      // Unknown must stay unknown: a module-provided filter, or one added since the docset was
      // published, must never be refused just because there is no range to check it against.
      expect(await messages(`{{ 'abc' | some_module_filter: 1, 2, 3, 4 }}`)).toEqual([]);
    });

    it('enforces only the minimum for a variadic filter', async () => {
      // `max: null` means "accepts any number, cannot refuse one".
      expect(await messages(`{{ 'abc' | dig: 'a', 'b', 'c', 'd' }}`)).toEqual([]);
    });

    it('says nothing about a filter that does not exist at all', async () => {
      // That is `UnknownFilter`'s question, not this check's. Reporting here too would
      // double up on one mistake.
      expect(await messages(`{{ 'abc' | no_such_filter_xyz: 1, 2, 3, 4, 5 }}`)).toEqual([]);
    });
  });

  describe('accepts correct calls across every arity shape', () => {
    it.each([
      ['exact arity, no arguments', `{{ 'abc' | upcase }}`],
      ['ranged arity, at the minimum', `{{ 'abcdef' | slice: 1 }}`],
      ['ranged arity, at the maximum', `{{ 'abcdef' | slice: 1, 2 }}`],
      ['ranged arity, in the middle', `{{ 'now' | add_to_time: 1, 'days' }}`],
      ['a named-argument call within range', `{{ 'abc' | truncate: length: 3 }}`],
      ['an alias, which carries its own arity', `{{ 'key' | t }}`],
      ["one of Liquid's own filters", `{% assign a = '' | split: ',' %}{{ a | sum }}`],
    ])('%s', async (_label, liquid) => {
      expect(await messages(liquid)).toEqual([]);
    });
  });

  /** The published range is what gets enforced, bound for bound. */
  describe('arity published by the docset', () => {
    const liquid = `{{ 'abc' | upcase: 1, 2 }}`;

    it('is what the check enforces, whatever the range says', async () => {
      // A range unlike the real `upcase` (exactly 1), so the silence can only come from this entry.
      const offenses = await check(
        { 'app/views/partials/file.liquid': liquid },
        [FilterArity],
        docsetWith([{ name: 'upcase', arity: { min: 1, max: 3 } }]),
      );

      expect(offenses).toEqual([]);
    });

    it('still reports a call outside the published range', async () => {
      // The control for the test above: the same docset entry must reject 4 arguments, so the
      // silence there is the range being honoured rather than the check being switched off.
      const offenses = await check(
        { 'app/views/partials/file.liquid': `{{ 'abc' | upcase: 1, 2, 3 }}` },
        [FilterArity],
        docsetWith([{ name: 'upcase', arity: { min: 1, max: 3 } }]),
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Filter 'upcase' is called with 4 arguments but accepts 1 to 3 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('enforces only the minimum for a variadic filter', async () => {
      // `max: null` means the filter accepts any number — `dig` and friends, which the runtime
      // probe could never measure because a variadic filter never complains. Fifteen arguments
      // must pass while a call below the minimum must not.
      const many = `{{ h | dig: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 }}`;
      const docset = docsetWith([{ name: 'dig', arity: { min: 2, max: null } }]);

      expect(
        await check({ 'app/views/partials/file.liquid': many }, [FilterArity], docset),
      ).toEqual([]);

      const tooFew = await check(
        { 'app/views/partials/file.liquid': `{{ h | dig }}` },
        [FilterArity],
        docset,
      );
      expect(tooFew.map((offense) => offense.message)).toEqual([
        "Filter 'dig' is called with 1 argument but accepts at least 2 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('says nothing when the entry carries no arity', async () => {
      // Inventing a bound for a blocking check would refuse working code. Paired with a control
      // that must still fire, so the silence is not the check being inert.
      const offenses = await check(
        {
          'app/views/partials/file.liquid': `${liquid}{{ 'y' | append: 1, 2, 3 }}`,
        },
        [FilterArity],
        docsetWith([{ name: 'upcase' }, { name: 'append', arity: { min: 2, max: 2 } }]),
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Filter 'append' is called with 4 arguments but accepts exactly 2 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('stays silent when the docset does not know the filter', async () => {
      // Paired with a control that MUST fire, so the silence cannot be the check being inert.
      const offenses = await check(
        {
          'app/views/partials/file.liquid': `{{ 'x' | some_module_filter: 1, 2, 3 }}{{ 'y' | upcase: 1 }}`,
        },
        [FilterArity],
        docsetWith([{ name: 'some_module_filter' }, { name: 'upcase', arity: { min: 1, max: 1 } }]),
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Filter 'upcase' is called with 2 arguments but accepts exactly 1 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });

    it('stays silent for a name that only Object.prototype answers', async () => {
      // A lookup built on an object literal answers these with inherited functions, which are
      // truthy. Paired with a control that must still fire.
      const offenses = await check(
        {
          'app/views/partials/file.liquid':
            `{{ 'x' | constructor }}{{ 'x' | toString: 1, 2 }}` +
            `{{ 'x' | valueOf }}{{ 'x' | hasOwnProperty: 1 }}` +
            `{{ 'y' | upcase: 1 }}`,
        },
        [FilterArity],
        docsetWith([{ name: 'upcase', arity: { min: 1, max: 1 } }]),
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Filter 'upcase' is called with 2 arguments but accepts exactly 1 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
      ]);
    });
  });

  /**
   * THE COUNT IS THIS CHECK'S, NOT `InvalidFilterName`'s.
   *
   * `{{ 'hello' | append: ' suffix', size }}` is correct SYNTAX — a colon after the name, a comma
   * between arguments — and still wrong, because `append` takes exactly 2 and this passes 3.
   * Measured: "append filter - wrong number of arguments (given 3, expected 2)". `InvalidFilterName`
   * deliberately stays silent on it and repairs only the separator, which is what lets this check
   * see the call at all: `| append, ' suffix', size` is rewritten to the form above and then
   * reported here. Two checks, one mistake each.
   */
  describe('a comma that legitimately separates arguments', () => {
    it('reports a call with too many arguments however the separator is spelled', async () => {
      const afterRepair = await check(
        { 'app/views/partials/file.liquid': `{{ 'hello' | append: ' suffix', size }}` },
        [FilterArity],
        docsetWith([{ name: 'append', arity: { min: 2, max: 2 } }]),
      );
      const ranged = await check(
        { 'app/views/partials/file.liquid': `{{ 'abcdef' | slice: 1, 2, 3 }}` },
        [FilterArity],
        docsetWith([{ name: 'slice', arity: { min: 2, max: 3 } }]),
      );

      expect({
        afterRepair: afterRepair.map((offense) => offense.message),
        ranged: ranged.map((offense) => offense.message),
      }).toEqual({
        afterRepair: [
          "Filter 'append' is called with 3 arguments but accepts exactly 2 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
        ],
        ranged: [
          "Filter 'slice' is called with 4 arguments but accepts 2 to 3 (the piped value counts as one). platformOS raises Liquid::ArgumentError at render time.",
        ],
      });
    });

    it('CONTROL: says nothing about the same shapes when the count is valid', async () => {
      // Without this, the assertions above would pass just as well if the check reported every
      // comma-separated call. Measured: `| slice: 1, 2` renders `bc` and `| append: ' s'` renders
      // `hello s`.
      const offenses = await check(
        {
          'app/views/partials/file.liquid': `{{ 'abcdef' | slice: 1, 2 }}{{ 'hello' | append: ' s' }}`,
        },
        [FilterArity],
        docsetWith([
          { name: 'slice', arity: { min: 2, max: 3 } },
          { name: 'append', arity: { min: 2, max: 2 } },
        ]),
      );

      expect(offenses.map((offense) => offense.message)).toEqual([]);
    });
  });
});
