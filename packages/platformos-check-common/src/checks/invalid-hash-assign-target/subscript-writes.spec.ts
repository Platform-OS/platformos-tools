import { describe, expect, it } from 'vitest';

import { InvalidHashAssignTarget } from './index';
import { highlightedOffenses, runLiquidCheck } from '../../test';
import type { PlatformOSDocset } from '../../types';

/**
 * `hash_assign` is not the only tag that writes into a Hash, and `assign` — the one an author
 * should reach for, since `hash_assign` is deprecated — reaches the SAME runtime setter.
 *
 * MEASURED against `/api/app_builder/liquid_exec`, every container × subscript combination, each
 * row reading the container back so "accepted" means the write happened rather than merely that
 * the tag parsed. `assign` and `hash_assign` agree on every one of them:
 *
 *                        x['k'] = 'V'          x[0] = 'V'          x.k = 'V'
 *   Hash                 writes                writes (key "0")    writes
 *   Array                raises, wants index   writes              raises, wants index
 *   String/Number/       raises, "expected Hash or Array" for every subscript
 *   Boolean/nil/unset
 *
 * The tests below are the same claims, at the check.
 *
 * Liquid has no array literal, so the only way to seed one is a filter — which makes the
 * docset load-bearing for exactly one of the containers. It is stubbed rather than taken from
 * the real docset so an upstream `return_type` change cannot quietly turn an Array fixture
 * into an untyped one, which every "must stay silent" case here would then pass vacuously.
 */
const docset = {
  async filters() {
    return [{ name: 'split', return_type: [{ type: 'array' }] }];
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

const messages = async (source: string) =>
  (
    await runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
      platformosDocset: docset,
    })
  ).map((offense) => offense.message);

const expectsHashOrArray = (tag: string, name: string, kind: string) =>
  `Cannot use ${tag} on '${name}', which is a ${kind}. ${tag} expects a Hash or an Array.`;

const needsIndex = (tag: string, name: string) =>
  `Cannot use ${tag} on '${name}' with a string key, because it is an Array. Use a numeric index instead.`;

const cannotAppend = (name: string, kind: string) =>
  `Cannot use '<<' on '${name}', which is a ${kind}. '<<' appends to an Array.`;

/** Seeds whose type the check can read, one per container the runtime distinguishes. */
const HASH = `{% parse_json x %}{}{% endparse_json %}`;
const ARRAY = `{% assign x = 'a,b' | split: ',' %}`;
const STRING = `{% assign x = 'abc' %}`;
const NUMBER = `{% assign x = 5 %}`;
const BOOLEAN = `{% assign x = true %}`;

describe('a subscript write is one rule, whichever tag spells it', () => {
  it('reports the same defect for assign as for hash_assign, naming the tag the author wrote', async () => {
    // The agreement property. Both columns are asserted whole and side by side, so a change
    // that fixes one spelling and forgets the other cannot pass — which is exactly how
    // `assign` came to be unchecked while `hash_assign` was covered in depth.
    const cases: Array<[label: string, seed: string, subscript: string, expected: string[]]> = [
      ['string, key', STRING, `x['k']`, [expectsHashOrArray('TAG', 'x', 'string')]],
      ['string, index', STRING, `x[0]`, [expectsHashOrArray('TAG', 'x', 'string')]],
      ['number, key', NUMBER, `x['k']`, [expectsHashOrArray('TAG', 'x', 'number')]],
      ['boolean, key', BOOLEAN, `x['k']`, [expectsHashOrArray('TAG', 'x', 'boolean')]],
      ['array, key', ARRAY, `x['k']`, [needsIndex('TAG', 'x')]],
      ['array, index', ARRAY, `x[0]`, []],
      ['hash, key', HASH, `x['k']`, []],
      ['hash, index', HASH, `x[0]`, []],
    ];

    const measured = await Promise.all(
      cases.map(async ([label, seed, subscript]) => [
        label,
        await messages(`${seed}{% assign ${subscript} = 'v' %}`),
        await messages(`${seed}{% hash_assign ${subscript} = 'v' %}`),
      ]),
    );

    expect(measured).toEqual(
      cases.map(([label, , , expected]) => [
        label,
        expected.map((message) => message.replace(/TAG/g, 'assign')),
        expected.map((message) => message.replace(/TAG/g, 'hash_assign')),
      ]),
    );
  });

  it('treats a dot target as a KEY, because the runtime does', async () => {
    // `{% assign x.k = 'v' %}` writes the key `k` — measured, `{"k":"V"}` read back — so it is
    // a key accessor and an Array must refuse it. `hash_assign` has no dot form at all: it
    // raises `Syntax Error in 'hash_assign'` at PARSE time, which is
    // `InvalidHashAssignTargetSyntax`'s finding and not this check's.
    expect([
      await messages(`${ARRAY}{% assign x.k = 'v' %}`),
      await messages(`${STRING}{% assign x.k = 'v' %}`),
      // The control: the same Array with the subscript the runtime accepts. Without it, a
      // rule that reported every dot target would satisfy the two assertions above.
      await messages(`${ARRAY}{% assign x[0] = 'v' %}`),
    ]).toEqual([[needsIndex('assign', 'x')], [expectsHashOrArray('assign', 'x', 'string')], []]);
  });

  it('highlights the target and nothing else, in every notation the grammar permits', async () => {
    const sources = [
      `${NUMBER}{% assign x['k'] = 'v' %}`,
      `${NUMBER}{% assign x["k"] = 'v' %}`,
      `${NUMBER}{% assign x[0] = 'v' %}`,
      `${NUMBER}{% assign x.k = 'v' %}`,
      // Whitespace INSIDE the brackets parses on the platform as well as here, so the span
      // has to be read from the source rather than computed as "last lookup end plus one".
      // (A space BEFORE the `[` is a platform parse error — see
      // `InvalidHashAssignTargetSyntax.spec.ts` — which is why the fixture does not use one.)
      `${NUMBER}{% assign x[ 'k' ] = 'v' %}`,
      `${NUMBER}{% assign x['a']['b'] = 'v' %}`,
    ];

    const highlighted = await Promise.all(
      sources.map(async (source) =>
        highlightedOffenses(
          source,
          await runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
            platformosDocset: docset,
          }),
        ),
      ),
    );

    expect(highlighted).toEqual([
      [`x['k']`],
      [`x["k"]`],
      [`x[0]`],
      [`x.k`],
      [`x[ 'k' ]`],
      [`x['a']['b']`],
    ]);
  });
});

describe('a write INTO a container does not replace it', () => {
  it('leaves a Hash a Hash, so the next write to it is not refused', async () => {
    // THE FALSE BLOCK this fixes. `{% assign h['k'] = 'V' %}` used to rebind `h` to the
    // VALUE's type, so the very next write to the same hash was refused as a write onto a
    // string — measured working on the runtime, and refused by a member of BLOCKING_CHECKS.
    expect(
      await messages(`{% parse_json h %}{}{% endparse_json %}
{% assign h['k'] = 'V' %}
{% hash_assign h['j'] = 'W' %}
{% assign h['m'] = 'X' %}`),
    ).toEqual([]);
  });

  it('still refuses the write when the variable really was replaced', async () => {
    // The control for the test above, differing in ONE character: `h` with no subscript is a
    // plain assignment, which REPLACES the hash with a string. A fix that simply stopped
    // tracking `assign` would pass the previous test and fail this one.
    expect(
      await messages(`{% parse_json h %}{}{% endparse_json %}
{% assign h = 'V' %}
{% hash_assign h['j'] = 'W' %}`),
    ).toEqual([expectsHashOrArray('hash_assign', 'h', 'string')]);
  });

  it('leaves an Array an Array, so a later string key on it is still refused', async () => {
    // The other direction, and the reason "the container becomes a Hash" is not the rule
    // either: a subscript write does not convert an Array, so the key-on-Array defect must
    // survive one. Paired with the index form, which must stay silent.
    expect([
      await messages(`${ARRAY}{% assign x[0] = 'v' %}{% hash_assign x['k'] = 'v' %}`),
      await messages(`${ARRAY}{% assign x[0] = 'v' %}{% assign x[1] = 'v' %}`),
    ]).toEqual([[needsIndex('hash_assign', 'x')], []]);
  });

  it('narrows an untyped variable to a Hash once it has been written into', async () => {
    // A write that reaches the runtime at all proves the container was of the right kind, so
    // what follows is knowable even though the seed was not. The control is the same buffer
    // without the intervening write, where nothing is knowable and nothing may be reported.
    expect([
      await messages(`{% assign x = params.thing %}{% assign x['k'] = 'v' %}{% assign x << 1 %}`),
      await messages(`{% assign x = params.thing %}{% assign x << 1 %}`),
    ]).toEqual([[cannotAppend('x', 'Hash')], []]);
  });
});

describe("'<<' appends to an Array, which is not the subscript-write rule", () => {
  it('refuses every container except an Array — including a Hash', async () => {
    // The Hash row is the falsifier that proves the two operators are not one rule: `=` wants
    // a Hash and refuses a scalar, `<<` wants an Array and refuses a Hash. Measured:
    // "x is {}, expected Array".
    const cases: Array<[label: string, seed: string, expected: string[]]> = [
      ['array', ARRAY, []],
      ['hash', HASH, [cannotAppend('x', 'Hash')]],
      ['string', STRING, [cannotAppend('x', 'string')]],
      ['number', NUMBER, [cannotAppend('x', 'number')]],
      ['boolean', BOOLEAN, [cannotAppend('x', 'boolean')]],
      ['untyped', `{% assign x = params.thing %}`, []],
    ];

    const measured = await Promise.all(
      cases.map(async ([label, seed]) => [label, await messages(`${seed}{% assign x << 'v' %}`)]),
    );

    expect(measured).toEqual(cases.map(([label, , expected]) => [label, expected]));
  });

  it('says nothing about an append THROUGH a subscript', async () => {
    // The runtime asks about the value AT the subscript, not about the container — measured,
    // "x[k] is null, expected Array" for a Hash whose `k` is unset. Nothing here tracks
    // element types, so this is a deliberate silence.
    //
    // The control is the same container with the same operator and NO subscript, which must
    // still fire: a fix that stopped visiting `<<` altogether would pass the first assertion.
    expect([
      await messages(`${HASH}{% assign x['k'] << 'v' %}`),
      await messages(`${HASH}{% assign x << 'v' %}`),
    ]).toEqual([[], [cannotAppend('x', 'Hash')]]);
  });

  it('leaves the Array it appended to an Array', async () => {
    // The second false block of the same shape: `<<` used to rebind the target to the
    // APPENDED value's type, so appending a number to an array made every later write to it
    // look like a write onto a number.
    expect([
      await messages(`${ARRAY}{% assign x << 5 %}{% assign x[0] = 'v' %}`),
      await messages(`${ARRAY}{% assign x << 5 %}{% assign x['k'] = 'v' %}`),
    ]).toEqual([[], [needsIndex('assign', 'x')]]);
  });
});

describe('what this check deliberately does not judge', () => {
  it('says nothing about a function target, whose write semantics are unmeasured', async () => {
    // `{% function h['k'] = 'partial' %}` PARSES — all eight target spellings reach partial
    // resolution rather than a syntax error — but what the write then does could not be
    // settled: it needs a partial that exists, and the oracle instance has none. Reporting on
    // an inference would be a false block in a check that refuses writes, so the target is
    // not judged and the variable goes untyped.
    //
    // The control is the identical buffer with `assign`, which IS measured and must fire.
    // Without it this test would keep passing if the check went silent everywhere.
    expect([
      await messages(`${STRING}{% function x['k'] = 'lib/p' %}`),
      await messages(`${STRING}{% assign x['k'] = 'v' %}`),
    ]).toEqual([[], [expectsHashOrArray('assign', 'x', 'string')]]);
  });

  it('says nothing about a nested target, whose intermediate value it cannot type', async () => {
    // Only the FIRST lookup is modelled. The runtime walks the whole chain and complains
    // about the intermediate — "x[0] is a, expected Hash or Array" — which needs the type of
    // `x[0]`, not of `x`. The control is the same seed with a single lookup.
    expect([
      await messages(`${ARRAY}{% assign x[0]['k'] = 'v' %}`),
      await messages(`${ARRAY}{% assign x['k'] = 'v' %}`),
    ]).toEqual([[], [needsIndex('assign', 'x')]]);
  });
});
