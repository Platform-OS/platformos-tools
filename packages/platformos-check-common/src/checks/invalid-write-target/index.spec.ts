import { describe, expect, it } from 'vitest';

import { highlightedOffenses, messagesOf, runLiquidCheck } from '../../test';
import type { PlatformOSDocset } from '../../types';
import { InvalidWriteTarget } from './index';

/**
 * Liquid has no array literal and no date literal, so the only way to seed one is a filter — which
 * makes the docset load-bearing for three of the containers. It is stubbed rather than taken from
 * the shipped documents so an upstream `return_type` change cannot quietly turn an Array fixture
 * into an untyped one, which every "must stay silent" case here would then pass vacuously.
 */
const docset = {
  async filters() {
    return [
      { name: 'split', return_type: [{ type: 'array' }] },
      { name: 'to_date', return_type: [{ type: 'date' }] },
      { name: 'to_time', return_type: [{ type: 'time' }] },
    ];
  },
  async graphQL() {
    return null;
  },
  async objects() {
    return [];
  },
  async tags() {
    return [];
  },
} as unknown as PlatformOSDocset;

// No DEFAULT for the docset: `undefined` is a case under test, and a default parameter would
// silently substitute the stub for it — which is what the "no docset at all" control caught.
const offensesIn = (source: string, platformosDocset: PlatformOSDocset | undefined) =>
  runLiquidCheck(InvalidWriteTarget, source, 'app/views/partials/file.liquid', {
    platformosDocset,
  });

const messages = async (source: string) => messagesOf(await offensesIn(source, docset));

/** The source each offense covers, for the tests whose subject is the span rather than the text. */
const highlighted = (sources: string[]) =>
  Promise.all(
    sources.map(async (source) => highlightedOffenses(source, await offensesIn(source, docset))),
  );

const needsHashOrArray = (name: string, kind: string) =>
  `Cannot write into '${name}', which is a ${kind}. A subscript write needs a Hash or an Array.`;

const needsIndex = (name: string) =>
  `Cannot write into '${name}' with a string key, because it is an Array. Use a numeric index instead.`;

const cannotAppend = (name: string, kind: string) =>
  `Cannot use '<<' on '${name}', which is a ${kind}. '<<' appends to an Array.`;

/**
 * One seed per container the runtime distinguishes.
 *
 * NOTHING SEPARATES A SEED FROM THE WRITE in any fixture here. A binding starts at the defining
 * tag's END offset, which is an offset the next tag can begin at exactly, and that abutting shape
 * is the one an author naturally writes and the only one that has ever failed.
 */
const HASH = `{% parse_json x %}{}{% endparse_json %}`;
const ARRAY = `{% assign x = 'a,b' | split: ',' %}`;
const STRING = `{% assign x = 'abc' %}`;
const NUMBER = `{% assign x = 5 %}`;
const BOOLEAN = `{% assign x = true %}`;
const RANGE = `{% assign x = (1..5) %}`;
const DATE = `{% assign x = 'd' | to_date %}`;
const TIME = `{% assign x = 't' | to_time %}`;
const UNTYPED = `{% assign x = params.thing %}`;

describe('Module: InvalidWriteTarget — a subscript write', () => {
  /**
   * MEASURED against `/api/app_builder/liquid_exec`, every row re-run 2026-08-16, each reading the
   * container back so "accepted" means the write happened rather than merely that the tag parsed:
   */
  const CASES: Array<[label: string, seed: string, subscript: string, expected: string[]]> = [
    ['hash, key', HASH, `x['k']`, []],
    ['hash, index', HASH, `x[0]`, []],
    ['array, key', ARRAY, `x['k']`, [needsIndex('x')]],
    ['array, index', ARRAY, `x[0]`, []],
    ['string, key', STRING, `x['k']`, [needsHashOrArray('x', 'string')]],
    ['string, index', STRING, `x[0]`, [needsHashOrArray('x', 'string')]],
    ['number, key', NUMBER, `x['k']`, [needsHashOrArray('x', 'number')]],
    ['boolean, key', BOOLEAN, `x['k']`, [needsHashOrArray('x', 'boolean')]],
    ['range, key', RANGE, `x['k']`, [needsHashOrArray('x', 'range')]],
    ['range, index', RANGE, `x[0]`, [needsHashOrArray('x', 'range')]],
    ['date, key', DATE, `x['k']`, [needsHashOrArray('x', 'date')]],
    ['time, index', TIME, `x[0]`, [needsHashOrArray('x', 'time')]],
    ['untyped, key', UNTYPED, `x['k']`, []],
    ['untyped, index', UNTYPED, `x[0]`, []],
    // `x[y]` resolves at runtime, so the Array rules cannot be told apart and nothing may be
    // reported — but a primitive's complaint is about the TARGET, so the subscript changes nothing.
    ['array, runtime subscript', ARRAY, `x[y]`, []],
    ['number, runtime subscript', NUMBER, `x[y]`, [needsHashOrArray('x', 'number')]],
  ];

  it('answers the same for the three tags that spell one write', async () => {
    const measured = await Promise.all(
      CASES.map(async ([label, seed, subscript]) => [
        label,
        await messages(`${seed}{% assign ${subscript} = 'v' %}`),
        await messages(`${seed}{% hash_assign ${subscript} = 'v' %}`),
        await messages(`${seed}{% function ${subscript} = 'partials/p' %}`),
      ]),
    );

    expect(measured).toEqual(
      CASES.map(([label, , , expected]) => [label, expected, expected, expected]),
    );
  });

  it('treats a dot target as a KEY, because the runtime does', async () => {
    // `{% assign x.k = 'v' %}` and `{% function x.k = 'p' %}` both write the key `k` — measured,
    // `{"k":…}` read back — so an Array must refuse them. `hash_assign` has no dot form: it raises
    // `Liquid::SyntaxError` at PARSE time, which is `InvalidHashAssignTargetSyntax`'s finding.
    expect([
      await messages(`${ARRAY}{% assign x.k = 'v' %}`),
      await messages(`${ARRAY}{% function x.k = 'partials/p' %}`),
      await messages(`${ARRAY}{% assign x[0] = 'v' %}`),
    ]).toEqual([[needsIndex('x')], [needsIndex('x')], []]);
  });

  it('says nothing about a NESTED subscript, and still judges the first one', async () => {
    // The runtime walks the whole chain and complains about the INTERMEDIATE value — measured,
    // `x[0]['k']` on an Array of strings raises "x[0] is a, expected Hash or Array". Answering that
    // needs the type of `x[0]`, and nothing here tracks element types. The second row is why
    // guessing would be worse than silence: `x['a'][0]` RENDERS when `x['a']` is a Hash.
    expect([
      await messages(`${ARRAY}{% assign x[0]['k'] = 'v' %}`),
      await messages(`{% parse_json x %}{"a": {}}{% endparse_json %}{% assign x['a'][0] = 'v' %}`),
      await messages(`${ARRAY}{% assign x['k'][0] = 'v' %}`),
    ]).toEqual([[], [], [needsIndex('x')]]);
  });

  it('highlights the target and nothing else, in every notation the grammar permits', async () => {
    const spans = await highlighted([
      `${NUMBER}{% assign x['k'] = 'v' %}`,
      `${NUMBER}{% assign x["k"] = 'v' %}`,
      `${NUMBER}{% assign x[0] = 'v' %}`,
      `${NUMBER}{% assign x.k = 'v' %}`,
      `${NUMBER}{% assign x['a']['b'] = 'v' %}`,
      // Whitespace INSIDE the brackets parses on the platform as well as here, so `assign`'s span
      // has to be read from the source rather than computed as "last lookup end plus one". (A space
      // BEFORE the `[` is a platform parse error — see `InvalidHashAssignTargetSyntax.spec.ts`.)
      `${NUMBER}{% assign x[ 'k' ] = 'v' %}`,
      // These two publish a node spanning the target, so they are the control on that scan: the
      // same span has to come out whether it was read from the source or from the node.
      `${NUMBER}{% hash_assign x['k'] = 'v' %}`,
      `${NUMBER}{% function x['k'] = 'partials/p' %}`,
    ]);

    expect(spans).toEqual([
      [`x['k']`],
      [`x["k"]`],
      [`x[0]`],
      [`x.k`],
      [`x['a']['b']`],
      [`x[ 'k' ]`],
      [`x['k']`],
      [`x['k']`],
    ]);
  });
});

describe("Module: InvalidWriteTarget — '<<' appends to an Array", () => {
  /**
   * A DIFFERENT RULE from a subscript write, sharing nothing with it but the tags. The Hash row is
   * the falsifier that proves it: `=` wants a Hash and refuses a scalar, `<<` wants an Array and
   * refuses a Hash — measured, "x is {}, expected Array".
   */
  const CASES: Array<[label: string, seed: string, expected: string[]]> = [
    ['array', ARRAY, []],
    ['hash', HASH, [cannotAppend('x', 'Hash')]],
    ['string', STRING, [cannotAppend('x', 'string')]],
    ['number', NUMBER, [cannotAppend('x', 'number')]],
    ['boolean', BOOLEAN, [cannotAppend('x', 'boolean')]],
    ['range', RANGE, [cannotAppend('x', 'range')]],
    ['date', DATE, [cannotAppend('x', 'date')]],
    ['time', TIME, [cannotAppend('x', 'time')]],
    ['untyped', UNTYPED, []],
  ];

  it('refuses every container except an Array, for both tags that spell an append', async () => {
    const measured = await Promise.all(
      CASES.map(async ([label, seed]) => [
        label,
        await messages(`${seed}{% assign x << 'v' %}`),
        await messages(`${seed}{% function x << 'partials/p' %}`),
      ]),
    );

    expect(measured).toEqual(CASES.map(([label, , expected]) => [label, expected, expected]));
  });

  it('says nothing about an append THROUGH a subscript', async () => {
    // The runtime asks about the value AT the subscript, not about the container — measured,
    // "x[k] is null, expected Array" for a Hash whose `k` is unset, and the same buffer renders
    // once `k` holds an Array. Nothing here tracks element types, so this is a deliberate silence.
    expect([
      await messages(`${HASH}{% assign x['k'] << 'v' %}`),
      await messages(`${HASH}{% function x['k'] << 'partials/p' %}`),
      await messages(`${HASH}{% assign x << 'v' %}`),
    ]).toEqual([[], [], [cannotAppend('x', 'Hash')]]);
  });

  it('highlights the whole markup, since the target alone is not the defect', async () => {
    // Up to the code and no further: a markup node's position runs to the tag's `%}` and takes
    // the whitespace before it along, which would put the squiggle a character past the value.
    const spans = await highlighted([
      `${HASH}{% assign x << 'v' %}`,
      `${HASH}{% assign x << 'v'%}`,
      `${HASH}{% function x << 'partials/p', a: 1 %}`,
    ]);

    expect(spans).toEqual([[`x << 'v'`], [`x << 'v'`], [`x << 'partials/p', a: 1`]]);
  });
});

describe('Module: InvalidWriteTarget — a write INTO a container does not replace it', () => {
  it('leaves a Hash a Hash and an Array an Array, so the next write is not refused', async () => {
    // THE FALSE BLOCK this guards. A subscript write used to rebind the target to the VALUE's type
    // and `<<` to the APPENDED value's, so the very next write to the same container was refused —
    // on a member of the supervisor's `BLOCKING_CHECKS`.
    expect([
      await messages(`${HASH}{% assign x['k'] = 'V' %}{% hash_assign x['j'] = 'W' %}`),
      await messages(`${ARRAY}{% assign x << 5 %}{% assign x[0] = 'v' %}`),
      await messages(`${ARRAY}{% function x[0] = 'partials/p' %}{% assign x[1] = 'v' %}`),
      // The controls, in the direction that must still fire: a write INTO an Array does not make
      // it a Hash, so a string key is still refused afterwards.
      await messages(`${ARRAY}{% assign x << 5 %}{% assign x['k'] = 'v' %}`),
      await messages(`${ARRAY}{% function x << 'partials/p' %}{% assign x['k'] = 'v' %}`),
    ]).toEqual([[], [], [], [needsIndex('x')], [needsIndex('x')]]);
  });

  it('still refuses the write when the variable really was replaced', async () => {
    // The control for the row above, differing in one subscript: `x` with no subscript is a plain
    // assignment, which REPLACES the hash with a string. A fix that simply stopped tracking
    // `assign` would pass the previous test and fail this one.
    expect([
      await messages(`${HASH}{% assign x = 'V' %}{% hash_assign x['j'] = 'W' %}`),
      await messages(`${HASH}{% assign x = 'V' %}{% assign x << 'W' %}`),
    ]).toEqual([[needsHashOrArray('x', 'string')], [cannotAppend('x', 'string')]]);
  });

  it('narrows an untyped variable once it has been written into', async () => {
    // A write that reaches the runtime at all proves the container was of the right kind, so what
    // follows is knowable even though the seed was not. The control is the same buffer without the
    // intervening write, where nothing is knowable and nothing may be reported.
    expect([
      await messages(`${UNTYPED}{% assign x['k'] = 'v' %}{% assign x << 1 %}`),
      await messages(`${UNTYPED}{% assign x << 1 %}`),
    ]).toEqual([[cannotAppend('x', 'Hash')], []]);
  });
});

describe('Module: InvalidWriteTarget — what it declines to infer', () => {
  it('says nothing when the value has no knowable type', async () => {
    // Two ways to be unknown. A filter the docset does not list at all — a guess there would refuse
    // working code, since this check BLOCKS. And an ELEMENT-returning filter, whose type is the
    // array's element type and which no probe can measure: reading it off a fixture of hashes
    // reports the fixture's shape, not the filter's, and would refuse `{% assign row << 'v' %}`
    // after any `| find` over an array of arrays.
    expect([
      await messages(`{% assign x = 'a' | not_in_the_docset %}{% assign x['k'] = 'v' %}`),
      await messages(`{% assign row = rows | find: 'k', 1 %}{% assign row << 'v' %}`),
      await messages(`${HASH}{% assign x << 'v' %}`),
    ]).toEqual([[], [], [cannotAppend('x', 'Hash')]]);
  });

  it('degrades to silence when no docset is available at all', async () => {
    // Filter types are then unknowable. The check keeps working on unfiltered assignments — the
    // majority — rather than switching itself off.
    const withoutDocset = async (source: string) => messagesOf(await offensesIn(source, undefined));

    expect([
      await withoutDocset(`${ARRAY}{% assign x['k'] = 'v' %}`),
      await withoutDocset(`${NUMBER}{% assign x['k'] = 'v' %}`),
    ]).toEqual([[], [needsHashOrArray('x', 'number')]]);
  });
});

describe('Module: InvalidWriteTarget — reads the shared, scoped type table', () => {
  it('honours the scoping the table applies, rather than a range of its own', async () => {
    // `variable-types.spec.ts` owns each of these rules; what is asserted here is that this check
    // resolves through that table and inherits them, which it did not before the table was shared.
    // Every row is paired with a straight-line control that must still fire.
    expect([
      // A conditional write is not a fact past the branch it sits in...
      await messages(`{% if c %}${NUMBER}{% endif %}{% assign x['k'] = 'v' %}`),
      await messages(`{% if c %}${NUMBER}{% assign x['k'] = 'v' %}{% endif %}`),
      // ...a loop variable does not inherit the type of the name it shadows...
      await messages(`${NUMBER}{% for x in list %}{% assign x['k'] = 'v' %}{% endfor %}`),
      await messages(`${NUMBER}{% for i in list %}{% assign x['k'] = 'v' %}{% endfor %}`),
      // ...and unreadable markup may have assigned anything.
      await messages(`${NUMBER}{% assign %}{% assign x['k'] = 'v' %}`),
      await messages(`${NUMBER}{% assign y = 1 %}{% assign x['k'] = 'v' %}`),
    ]).toEqual([
      [],
      [needsHashOrArray('x', 'number')],
      [],
      [needsHashOrArray('x', 'number')],
      [],
      [needsHashOrArray('x', 'number')],
    ]);
  });
});
