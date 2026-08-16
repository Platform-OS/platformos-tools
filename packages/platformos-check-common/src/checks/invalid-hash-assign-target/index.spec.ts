import { describe, it, expect } from 'vitest';

import { DOCSET_TYPES as DOCSET_RETURN_TYPES } from '../../liquid-types';
import { InvalidHashAssignTarget, variableTypeOf } from './index';
import { check, highlightedOffenses, MockApp, messagesOf, runLiquidCheck } from '../../test';
import type { PlatformOSDocset } from '../../types';

/**
 * The definers whose type the check declines to infer, and which must therefore stay
 * silent. Every other definer — `assign`, `capture`, `increment`, `parse_json`, `graphql`
 * — is covered by the adjacency group below, which asserts positions as well as messages.
 */
describe('Module: InvalidHashAssignTarget', () => {
  it('should not report an error when hash_assign is used on an untyped variable', async () => {
    const app: MockApp = {
      'app/views/partials/file.liquid': `
        {% hash_assign unknown_var['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should not report an error when hash_assign is used on a function return with variable partial', async () => {
    const app: MockApp = {
      'app/views/partials/file.liquid': `
        {% assign partial_name = 'lib/get_data' %}
        {% function data = partial_name %}
        {% hash_assign data['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should not report an error when function uses hash-access result target and hash_assign follows', async () => {
    const app: MockApp = {
      'app/views/partials/file.liquid': `
        {% parse_json my_hash %}{}{% endparse_json %}
        {% function my_hash['result'] = 'lib/get_data' %}
        {% hash_assign my_hash['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(messagesOf(offenses)).toEqual([]);
  });
});

/**
 * Tag ADJACENCY — the boundary the type lookup used to get wrong.
 *
 * Every case above separates its tags with a newline, which is why the defect
 * survived: the check tracks a type over a range STARTING at the defining tag's end
 * offset, and tested `position <= start`, so a `hash_assign` beginning at exactly
 * that offset was excluded. With no character between the tags those two numbers are
 * equal, and the check reported nothing on a buffer the runtime raises
 * `HashAssignTagError` for — a false approval on a member of `BLOCKING_CHECKS`.
 *
 * An external evaluation read that silence as the check being DEAD, and a round of
 * work was aimed at the wrong file on the strength of it. It fires with one space
 * inserted. So these cases pin the boundary from both sides: a minimal single-line
 * buffer is what an author naturally writes, and it was the only shape that failed.
 *
 * Positions are asserted exactly. The fix changes which type entry a lookup matches,
 * so "still reports" is not enough — it has to report the same span it always did.
 */
describe('Module: InvalidHashAssignTarget — tag adjacency', () => {
  const offensesIn = async (source: string) =>
    (await runLiquidCheck(InvalidHashAssignTarget, source)).map((offense) => ({
      message: offense.message,
      start: { line: offense.start.line, character: offense.start.character },
      end: { line: offense.end.line, character: offense.end.character },
    }));

  /** The reported message, spelled as the check spells it. */
  const cannotUse = (name: string, kind: string) =>
    `Cannot use hash_assign on '${name}', which is a ${kind}. hash_assign expects a Hash or an Array.`;

  const HASH_ASSIGN = "{% hash_assign x['k'] = 'v' %}";

  it('reports the same defect however the two tags are separated', async () => {
    // The agreement property, stated in one place: separation is formatting, not
    // meaning, so all three shapes must produce the same finding. Only the span
    // moves, and it moves exactly as much as the separator.
    const assign = '{% assign x = 5 %}';
    const message = cannotUse('x', 'number');

    expect([
      await offensesIn(`${assign}${HASH_ASSIGN}`),
      await offensesIn(`${assign} ${HASH_ASSIGN}`),
      await offensesIn(`${assign}\n${HASH_ASSIGN}`),
    ]).toEqual([
      [{ message, start: { line: 0, character: 33 }, end: { line: 0, character: 39 } }],
      [{ message, start: { line: 0, character: 34 }, end: { line: 0, character: 40 } }],
      [{ message, start: { line: 1, character: 15 }, end: { line: 1, character: 21 } }],
    ]);
  });

  it('reports every primitive target type when the tags are adjacent', async () => {
    // All four report branches, in the shape that used to silence all of them. Each
    // raises `HashAssignTagError` on a live instance.
    expect([
      await offensesIn(`{% assign x = 5 %}${HASH_ASSIGN}`),
      await offensesIn(`{% assign x = 'hi' %}${HASH_ASSIGN}`),
      await offensesIn(`{% assign x = true %}${HASH_ASSIGN}`),
      await offensesIn(`{% assign x = (1..5) %}${HASH_ASSIGN}`),
    ]).toEqual([
      [
        {
          message: cannotUse('x', 'number'),
          start: { line: 0, character: 33 },
          end: { line: 0, character: 39 },
        },
      ],
      [
        {
          message: cannotUse('x', 'string'),
          start: { line: 0, character: 36 },
          end: { line: 0, character: 42 },
        },
      ],
      [
        {
          message: cannotUse('x', 'boolean'),
          start: { line: 0, character: 36 },
          end: { line: 0, character: 42 },
        },
      ],
      [
        {
          message: cannotUse('x', 'range'),
          start: { line: 0, character: 38 },
          end: { line: 0, character: 44 },
        },
      ],
    ]);
  });

  it('reports a block and a counter definer too, not only assign', async () => {
    // `capture` and `increment` push their ranges from a different offset — the block
    // end and the tag end respectively — so they are separate paths to the same
    // boundary, and both were equally blind.
    expect([
      await offensesIn(`{% capture x %}hi{% endcapture %}${HASH_ASSIGN}`),
      await offensesIn(`{% increment c %}{% hash_assign c['k'] = 'v' %}`),
    ]).toEqual([
      [
        {
          message: cannotUse('x', 'string'),
          start: { line: 0, character: 48 },
          end: { line: 0, character: 54 },
        },
      ],
      [
        {
          message: cannotUse('c', 'number'),
          start: { line: 0, character: 32 },
          end: { line: 0, character: 38 },
        },
      ],
    ]);
  });

  it('stays silent for object and untyped definers when adjacent', async () => {
    // The other half of the boundary. Widening the lookup must not start reporting
    // targets that are legitimately hash-assignable: `parse_json` and `graphql` both
    // produce objects, and a `function` return is untyped — an inference we decline
    // to make rather than one we make wrongly.
    expect([
      await offensesIn(`{% parse_json h %}{}{% endparse_json %}{% hash_assign h['b'] = 2 %}`),
      await offensesIn(`{% graphql r %}query { a }{% endgraphql %}{% hash_assign r['b'] = 2 %}`),
      await offensesIn(`{% function d = 'lib/x' %}{% hash_assign d['k'] = 'v' %}`),
      await offensesIn(`{% assign x = '{}' | parse_json %}${HASH_ASSIGN}`),
    ]).toEqual([[], [], [], []]);
  });

  it('resolves a reassignment whose ranges abut to the LATEST type', async () => {
    // The fix has to hold with CLOSED ranges in play, not just one open range. With
    // nothing between any of the four tags the first entry is closed at the very
    // offset it opened at, and the lookup that matters sits on the start of a third
    // entry — so this fails under the old exclusive bound for the same reason the
    // simple cases do, while also pinning that the stale entries stay excluded.
    // Exactly one offense, on the SECOND hash_assign; the first is on an object.
    expect(
      await offensesIn(
        `{% assign x = '{}' | parse_json %}{% hash_assign x['a'] = 1 %}` +
          `{% assign x = 5 %}{% hash_assign x['b'] = 2 %}`,
      ),
    ).toEqual([
      {
        message: cannotUse('x', 'number'),
        start: { line: 0, character: 95 },
        end: { line: 0, character: 101 },
      },
    ]);
  });
});

/**
 * FILTER RETURN TYPES and the SUBSCRIPT — the two things the check used to get wrong
 * together, which is why the symptom looked like one bug.
 *
 * The old inference held four hand-written arrays of filter names. `split` appeared
 * in BOTH the string list and the array list; the string branch ran first, so
 * `{% assign x = '' | split: ',' %}{% hash_assign x[0] = 'v' %}` — which renders
 * fine — was reported as a hash_assign on a string. And the report itself ignored
 * the subscript entirely, describing the rule as "can only be used on object types",
 * which is not what the runtime enforces: it wants a Hash OR an Array, with a key
 * for the first and an index for the second.
 *
 * Both halves matter because this check is in the supervisor's `BLOCKING_CHECKS`, so
 * an offense refuses the write. Every row below is measured against a live instance
 * and recorded in TASK-27.
 *
 * The docset here mirrors the real `filters.json` shapes, including the one filter
 * that genuinely ships with no `return_type` at all.
 */
describe('Module: InvalidHashAssignTarget — filter return types and subscripts', () => {
  const docset = {
    async graphQL() {
      return null;
    },
    async objects() {
      return [];
    },
    async tags() {
      return [];
    },
    async filters() {
      return [
        { name: 'split', return_type: [{ type: 'array' }] },
        { name: 'parse_json', return_type: [{ type: 'hash' }] },
        { name: 'upcase', return_type: [{ type: 'string' }] },
        { name: 'size', return_type: [{ type: 'number' }] },
        { name: 'has', return_type: [{ type: 'boolean' }] },
        { name: 'new_line_to_br', return_type: [{ type: 'string' }] },
        { name: 'array_index_of', return_type: [{ type: 'number' }] },
        // Spellings the runtime settled, so they are interpreted rather than ignored.
        { name: 'to_time', return_type: [{ type: 'time' }] },
        { name: 'to_date', return_type: [{ type: 'date' }] },
        { name: 'parse_csv', return_type: [{ type: 'array of arrays' }] },
        // Still deliberately uninterpreted: a union is not narrowable by measurement.
        { name: 'first_or_nil', return_type: [{ type: 'string, nil' }] },
      ];
    },
  } as unknown as PlatformOSDocset;

  const offensesIn = async (source: string) =>
    (
      await runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
        platformosDocset: docset,
      })
    ).map((offense) => ({
      message: offense.message,
      start: { line: offense.start.line, character: offense.start.character },
      end: { line: offense.end.line, character: offense.end.character },
    }));

  const expectsHashOrArray = (name: string, kind: string) =>
    `Cannot use hash_assign on '${name}', which is a ${kind}. hash_assign expects a Hash or an Array.`;
  const needsIndex = (name: string) =>
    `Cannot use hash_assign on '${name}' with a string key, because it is an Array. Use a numeric index instead.`;

  it('accepts an index-assign into a filter-produced Array — the false block', async () => {
    // AC#1, and the reason this task exists. Runtime renders `["value"]`.
    expect(
      await offensesIn(`{% assign x = '' | split: ',' %}\n{% hash_assign x[0] = 'v' %}`),
    ).toEqual([]);
  });

  it('still reports a key-assign into that same Array', async () => {
    // AC#5. Runtime raises "expected index, key was provided" — so the old check got
    // the OUTCOME right here while getting the reason wrong (it thought `x` was a
    // string). Same verdict, correct reason, and a message an author can act on.
    expect(
      await offensesIn(`{% assign x = '' | split: ',' %}\n{% hash_assign x['k'] = 'v' %}`),
    ).toEqual([
      {
        message: needsIndex('x'),
        start: { line: 1, character: 15 },
        end: { line: 1, character: 21 },
      },
    ]);
  });

  it('says nothing when the subscript cannot be read statically', async () => {
    // `x[y]` resolves at runtime. Reporting it would mean guessing which of the two
    // Array rules applies, and guessing wrong refuses working code.
    expect(
      await offensesIn(`{% assign x = '' | split: ',' %}\n{% hash_assign x[y] = 'v' %}`),
    ).toEqual([]);
  });

  it('says nothing about a NESTED subscript, which is a known and bounded gap', async () => {
    // AC#5, asserted rather than only commented, so the gap is a recorded behaviour and
    // not something a later reader has to infer from silence.
    //
    // The runtime walks the whole chain and complains about the INTERMEDIATE value —
    // measured: `x[0]['k']` on an Array of strings raises "x[0] is a, expected Hash or
    // Array". Answering that needs the type of `x[0]`, and nothing here tracks element
    // types. The second case is why guessing would be worse than silence: `x['a'][0]`
    // RENDERS when `x['a']` is a Hash, so "the last subscript must match the container"
    // is not the rule, and a check built on it would refuse working code.
    expect([
      await offensesIn(`{% assign x = '' | split: ',' %}\n{% hash_assign x[0]['k'] = 'v' %}`),
      await offensesIn(
        `{% parse_json x %}{"a": {}}{% endparse_json %}\n{% hash_assign x['a'][0] = 'v' %}`,
      ),
    ]).toEqual([[], []]);
  });

  it('still reports the FIRST subscript when a nested one follows it', async () => {
    // The gap above is bounded to the nesting, not a blanket exemption: `x` is an Array
    // and the first subscript is a string key, which the runtime refuses regardless of
    // what comes after. Losing this would turn a bounded gap into a silent one.
    expect(
      await offensesIn(`{% assign x = '' | split: ',' %}\n{% hash_assign x['k'][0] = 'v' %}`),
    ).toEqual([
      {
        message: needsIndex('x'),
        start: { line: 1, character: 15 },
        end: { line: 1, character: 24 },
      },
    ]);
  });

  it('reads the return type of the LAST filter in a chain', async () => {
    // Every earlier filter is input to the next, so only the last one decides.
    expect(
      await offensesIn(
        `{% assign x = 'a,b' | split: ',' | size %}\n{% hash_assign x['k'] = 'v' %}`,
      ),
    ).toEqual([
      {
        message: expectsHashOrArray('x', 'number'),
        start: { line: 1, character: 15 },
        end: { line: 1, character: 21 },
      },
    ]);
  });

  it('reports a filter-produced primitive, and stays silent on a filter-produced Hash', async () => {
    // AC#2 in both directions.
    expect([
      await offensesIn(`{% assign x = 'a' | upcase %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = '{}' | parse_json %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([
      [
        {
          message: expectsHashOrArray('x', 'string'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
      [],
    ]);
  });

  it('treats an UNKNOWN return type as unknown, never as a guess', async () => {
    // Two ways to be unknown, both of which must produce nothing: a filter the docset
    // does not list at all, and one whose return type is a UNION (`string, nil`). A union
    // is not narrowable by measurement — the value is a string on one branch and nil on
    // the other — so it stays unknown by design rather than for want of a probe.
    expect([
      await offensesIn(`{% assign x = 'a' | not_in_the_docset %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | first_or_nil %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([[], []]);
  });

  it('reports a date or time target, with the type named in the message', async () => {
    // The `date` / `datetime` / `time` narrowing. Measured: `to_date` yields a Date and
    // `to_time` a Time, and BOTH subscripts raise "expected Hash or Array" — the runtime
    // complains about the target, so the subscript makes no difference. The message names
    // the type so the author can see why, rather than being told to convert a Time.
    expect([
      await offensesIn(`{% assign x = 'a' | to_time %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | to_time %}\n{% hash_assign x[0] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | to_date %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([
      [
        {
          message: expectsHashOrArray('x', 'time'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
      [
        {
          message: expectsHashOrArray('x', 'time'),
          start: { line: 1, character: 15 },
          // `x[0]` is four characters where `x['k']` is six — the range covers the whole
          // subscripted target, so the two cases do not share an end column.
          end: { line: 1, character: 19 },
        },
      ],
      [
        {
          message: expectsHashOrArray('x', 'date'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
    ]);
  });

  it('gives an Array of Arrays the ARRAY remedy, not the Hash one', async () => {
    // `array of arrays` maps to `array`, so the two Array rules apply unchanged: a key is
    // wrong and gets the "use a numeric index" remedy, an index is fine and stays silent.
    // Measured on `parse_csv` both ways — telling an author to convert it to a Hash, or
    // refusing `x[0]`, would each be a false block.
    expect([
      await offensesIn(`{% assign x = 'a' | parse_csv %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | parse_csv %}\n{% hash_assign x[0] = 'v' %}`),
    ]).toEqual([
      [
        {
          message: needsIndex('x'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
      [],
    ]);
  });

  it('types new_line_to_br as a string and array_index_of as a number', async () => {
    expect([
      await offensesIn(`{% assign x = 'a' | new_line_to_br %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(
        `{% assign x = 'a' | array_index_of: 'b' %}\n{% hash_assign x['k'] = 'v' %}`,
      ),
    ]).toEqual([
      [
        {
          message: expectsHashOrArray('x', 'string'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
      [
        {
          message: expectsHashOrArray('x', 'number'),
          start: { line: 1, character: 15 },
          end: { line: 1, character: 21 },
        },
      ],
    ]);
  });

  it('leaves a spelling it declines to interpret untyped', async () => {
    expect([
      variableTypeOf({ name: 'first_or_nil', return_type: [{ type: 'string, nil' }] }),
      variableTypeOf({ name: 'array_index_of', return_type: [{ type: '' }] }),
    ]).toEqual(['untyped', 'untyped']);
  });

  it('answers untyped for a filter the docset does not carry', async () => {
    expect([
      variableTypeOf({ name: 'not_a_real_filter' }),
      variableTypeOf({ name: 'also_not_real', return_type: [] }),
    ]).toEqual(['untyped', 'untyped']);
  });

  it('reports a primitive whatever the subscript is', async () => {
    // The runtime's complaint for a primitive is about the TARGET — "x is 5, expected
    // Hash or Array" — so unlike the Array case the subscript changes nothing.
    expect(
      (
        await Promise.all([
          offensesIn(`{% assign x = 5 %}\n{% hash_assign x[0] = 'v' %}`),
          offensesIn(`{% assign x = 5 %}\n{% hash_assign x[y] = 'v' %}`),
        ])
      ).map((offenses) => offenses.map((offense) => offense.message)),
    ).toEqual([[expectsHashOrArray('x', 'number')], [expectsHashOrArray('x', 'number')]]);
  });

  it('keeps an Array an Array after an index-assign, so a later key-assign still reports', async () => {
    // `hash_assign` writes INTO the array; it does not convert it to a Hash. Recording
    // the target as `object` afterwards — which is what the check used to do
    // unconditionally — silences the very next line.
    expect(
      await offensesIn(
        `{% assign x = '' | split: ',' %}\n{% hash_assign x[0] = 'v' %}\n{% hash_assign x['k'] = 'w' %}`,
      ),
    ).toEqual([
      {
        message: needsIndex('x'),
        start: { line: 2, character: 15 },
        end: { line: 2, character: 21 },
      },
    ]);
  });

  it('degrades to silence when no docset is available at all', async () => {
    // Filter types are then unknowable. The check keeps working on unfiltered
    // assignments — the majority — rather than switching itself off.
    const withoutDocset = async (source: string) =>
      (
        await runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
          platformosDocset: undefined,
        })
      ).map((offense) => offense.message);

    expect([
      await withoutDocset(`{% assign x = 'a' | upcase %}\n{% hash_assign x['k'] = 'v' %}`),
      await withoutDocset(`{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([[], [expectsHashOrArray('x', 'number')]]);
  });
});

describe('Module: InvalidHashAssignTarget — subscript writes', () => {
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
            await runLiquidCheck(
              InvalidHashAssignTarget,
              source,
              'app/views/partials/file.liquid',
              {
                platformosDocset: docset,
              },
            ),
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

    it('applies the same rule to the function tag, which also appends', async () => {
      // `{% function items << 'p' %}` is the same append onto the same containers, and it went
      // unjudged: the operator did not exist on this tag until the append form began to parse, so
      // an append onto a String or a Hash cleared the write gate where the identical `{% assign %}`
      // was refused.
      //
      // Asserted against the assign spelling row for row, because the claim is that the two are ONE
      // rule — a table that only listed the function results could drift from it silently.
      const containers: Array<[label: string, seed: string]> = [
        ['array', ARRAY],
        ['hash', HASH],
        ['string', STRING],
        ['number', NUMBER],
        ['boolean', BOOLEAN],
      ];

      const measured = await Promise.all(
        containers.map(async ([label, seed]) => [
          label,
          await messages(`${seed}{% function x << 'partials/p' %}`),
          await messages(`${seed}{% assign x << 'v' %}`),
        ]),
      );

      expect(measured).toEqual([
        ['array', [], []],
        ['hash', [cannotAppend('x', 'Hash')], [cannotAppend('x', 'Hash')]],
        ['string', [cannotAppend('x', 'string')], [cannotAppend('x', 'string')]],
        ['number', [cannotAppend('x', 'number')], [cannotAppend('x', 'number')]],
        ['boolean', [cannotAppend('x', 'boolean')], [cannotAppend('x', 'boolean')]],
      ]);
    });

    it('says nothing about a function append THROUGH a subscript, and leaves an Array an Array', async () => {
      // Same two carve-outs as the assign spelling: a subscript append is the runtime's business at
      // the subscript, and an append must not rebind the container to the appended type. The second
      // row is the control that the visit still happens at all.
      expect([
        await messages(`${HASH}{% function x['k'] << 'partials/p' %}`),
        await messages(`${ARRAY}{% function x << 'partials/p' %}{% assign x['k'] = 'v' %}`),
      ]).toEqual([[], [needsIndex('assign', 'x')]]);
    });

    it('keeps the container type through a subscript function write, so later writes are judged', async () => {
      // NOT JUDGING the subscript target is deliberate; FORGETTING what the container is was not.
      // The function branch rebound the container to `untyped`, so the first row below reported
      // nothing at all — while the identical code with the middle tag deleted, or spelled
      // `{% assign %}`, reported the Hash append. A blocking check went blind to the write AFTER
      // the one it declined to judge.
      //
      // The third row is the control in the other direction: the type is KEPT, not overwritten
      // with 'hash', so an Array stays an Array and still demands an index.
      expect([
        await messages(`${HASH}{% function x['k'] << 'partials/p' %}{% assign x << 'v' %}`),
        await messages(`${HASH}{% function x['k'] = 'partials/p' %}{% assign x << 'v' %}`),
        await messages(`${ARRAY}{% function x[0] = 'partials/p' %}{% assign x['k'] = 'v' %}`),
      ]).toEqual([
        [cannotAppend('x', 'Hash')],
        [cannotAppend('x', 'Hash')],
        [needsIndex('assign', 'x')],
      ]);
    });

    it('says nothing about an append onto the result of an element-returning filter', async () => {
      // `find` returns an ELEMENT of the array it is handed, so its type is the array's element
      // type and no probe can measure it: probing one against a fixture of hashes reads back
      // `hash`, which is the fixture's shape and not the filter's. This check BLOCKS, so taking
      // that reading refuses `{% assign row << 'v' %}` after any `| find` — i.e. on every array
      // whose elements are arrays. The gem says `@liquid_return [untyped]`, and untyped is silence.
      expect([
        await messages(`{% assign row = rows | find: 'k', 1 %}{% assign row << 'v' %}`),
        // The control, or the row above would pass with the append rule deleted outright.
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
  });
});

/**
 * Whether the check reports on `{% assign x = 'a' | <name> %}{% hash_assign x[…] %}`.
 *
 * THE ARGUMENTS ARE IRRELEVANT AND THAT IS THE POINT: the check reads the LAST filter's name and
 * looks its return type up in the docset. It never evaluates arguments, so `'a' | anything`
 * exercises it identically to a fully-formed call.
 *
 * BOTH SHAPES ARE RUN because this check has already had one boundary defect that only one of
 * them could see: a range starts at the defining tag's end offset, and Liquid tags may abut with
 * nothing between them, so `{% assign %}{% hash_assign %}` and the same pair split by a newline
 * took different paths. Using one shape would leave a blind spot exactly where the last bug was.
 */
const reportsFor = async (
  name: string,
  subscript: string,
  docset: PlatformOSDocset,
): Promise<boolean> => {
  const assign = `{% assign x = 'a' | ${name} %}`;
  const hashAssign = `{% hash_assign x[${subscript}] = 'v' %}`;

  const shapes = await Promise.all(
    [`${assign}${hashAssign}`, `${assign}\n${hashAssign}`].map((source) =>
      runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
        platformosDocset: docset,
      }),
    ),
  );

  const [adjacent, newline] = shapes.map((offenses) => offenses.length > 0);
  if (adjacent !== newline) {
    throw new Error(
      `${name}[${subscript}]: adjacent and newline-separated shapes disagree ` +
        `(adjacent=${adjacent}, newline=${newline}). The tags abut at a single offset in ` +
        `the first shape; see findVariableType's inclusive start bound.`,
    );
  }
  return adjacent;
};

describe('Module: InvalidHashAssignTarget — a return type it cannot interpret', () => {
  it('reports nothing for a filter whose published spelling it does not recognise', async () => {
    // Driven by an injected entry rather than the shipped docset, which publishes no unrecognised
    // spelling today: the rule is that an unmapped spelling is silence, not a guess.
    const docset = {
      async filters() {
        return [{ name: 'weird_filter', return_type: [{ type: 'chronomancer', name: '' }] }];
      },
      async objects() {
        return [];
      },
      async tags() {
        return [];
      },
      async graphQL() {
        return null;
      },
    } as unknown as PlatformOSDocset;

    const reports = await Promise.all(
      [`'k'`, '0'].map(async (subscript) => ({
        subscript,
        reports: await reportsFor('weird_filter', subscript, docset),
      })),
    );

    expect(reports).toEqual([
      { subscript: `'k'`, reports: false },
      { subscript: '0', reports: false },
    ]);
  });
});

/**
 * SCOPE, which this check had none of until its type table was shared.
 *
 * It tracked ranges but not the BLOCKS they sit in, so a write in one arm of an `{% if %}` was a
 * fact for the rest of the file and a loop variable inherited whatever the outer name held. Both
 * are false-block shapes on a member of `BLOCKING_CHECKS`, and both are the shape
 * `shape-analysis.ts` had already modelled for the neighbouring question.
 */
describe('Module: InvalidHashAssignTarget — scope', () => {
  const messages = async (source: string) =>
    (await runLiquidCheck(InvalidHashAssignTarget, source)).map((offense) => offense.message);

  const cannotUse = (name: string, kind: string) =>
    `Cannot use hash_assign on '${name}', which is a ${kind}. hash_assign expects a Hash or an Array.`;

  const HASH_ASSIGN = "{% hash_assign x['k'] = 'v' %}";

  it('does not carry a conditional write past the branch it sits in', async () => {
    // Nobody knows whether the branch ran, so past `{% endif %}` nobody knows the type either.
    // CONTROL: inside the branch the write IS a fact, and a straight-line one is a fact after it.
    expect([
      await messages(`{% if c %}{% assign x = 5 %}{% endif %}${HASH_ASSIGN}`),
      await messages(`{% if c %}{% assign x = 5 %}${HASH_ASSIGN}{% endif %}`),
      await messages(`{% assign x = 5 %}${HASH_ASSIGN}`),
    ]).toEqual([[], [cannotUse('x', 'number')], [cannotUse('x', 'number')]]);
  });

  it('does not give a loop variable the type of the name it shadows', async () => {
    // `{% for x in … %}` rebinds `x` over the body; the outer number says nothing about the item,
    // and refusing the write on its authority refuses working code. CONTROL: a loop that binds a
    // DIFFERENT name leaves the outer type in place, and the write is still refused.
    expect([
      await messages(`{% assign x = 5 %}{% for x in list %}${HASH_ASSIGN}{% endfor %}`),
      await messages(`{% assign x = 5 %}{% for i in list %}${HASH_ASSIGN}{% endfor %}`),
    ]).toEqual([[], [cannotUse('x', 'number')]]);
  });

  it('forgets what it knew when an assigning tag does not parse', async () => {
    // Unreadable markup may have assigned anything, and `LiquidHTMLSyntaxError` owns saying so.
    // CONTROL: a readable tag in the same position changes nothing.
    expect([
      await messages(`{% assign x = 5 %}{% assign %}${HASH_ASSIGN}`),
      await messages(`{% assign x = 5 %}{% assign y = 1 %}${HASH_ASSIGN}`),
    ]).toEqual([[], [cannotUse('x', 'number')]]);
  });
});
