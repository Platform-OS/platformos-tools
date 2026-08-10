import { describe, it, expect } from 'vitest';

import {
  DOCSET_RETURN_TYPES,
  DOCSET_RETURN_TYPE_GAPS,
  InvalidHashAssignTarget,
  variableTypeOf,
} from './index';
import {
  FILTER_RETURN_TYPE_ORACLE,
  HASH_RETURN_TYPE_FILTERS,
  UNTYPED_RETURN_TYPE_SPELLINGS,
  type FilterReturnTypeMeasurement,
  type RuntimeOutcome,
} from './filter-return-type-oracle';
import filtersJson from '../../../../platformos-check-docs-updater/data/filters.json';
import { UNDOCUMENTED_FILTERS } from '../../undocumented-filters';
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
        // The two DOCSET DATA HOLES: no `return_type` at all, and one whose `type` is the
        // empty string. Both are typed through DOCSET_RETURN_TYPE_GAPS from a direct
        // runtime measurement, because the docset has nothing to map.
        { name: 'new_line_to_br' },
        { name: 'array_index_of', return_type: [{ type: '' }] },
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

  it('types the two filters the docset has NO return_type for, naming it as a data gap', async () => {
    // AC#3, and the case that is a data defect rather than a modelling choice.
    // `new_line_to_br` ships with no `return_type` and `array_index_of` with an empty one;
    // `data/filters.json` is re-downloaded from documentation.platformos.com on every
    // build, so the correction cannot live there. Both were measured directly — a String
    // and an Integer, raising on either subscript — and typed through
    // DOCSET_RETURN_TYPE_GAPS.
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

  it('does NOT let the gap table override a spelling it declines to interpret', async () => {
    // The rule that keeps DOCSET_RETURN_TYPE_GAPS from becoming a second, quieter mapping
    // table: it answers only where the docset has NO data. `first_or_nil` carries a
    // spelling (`string, nil`) this check refuses to interpret, so even if the gap table
    // named it, the spelling would still win and the result would still be silence.
    expect([
      variableTypeOf({ name: 'first_or_nil', return_type: [{ type: 'string, nil' }] }),
      // A name the gap table DOES hold, but carrying a spelling — the spelling wins.
      variableTypeOf({ name: 'new_line_to_br', return_type: [{ type: 'string, nil' }] }),
      variableTypeOf({ name: 'new_line_to_br' }),
      variableTypeOf({ name: 'array_index_of', return_type: [{ type: '' }] }),
      variableTypeOf({ name: 'not_a_real_filter' }),
    ]).toEqual(['untyped', 'untyped', 'string', 'number', 'untyped']);
  });

  it('does NOT let the UNDOCUMENTED types override a spelling either', async () => {
    // The same precedence rule for the second measured fallback, and it needs its own
    // test for a reason worth writing down: NO undocumented filter carries a docset
    // `return_type`, because being absent from the docset is what makes it undocumented.
    // So the ordering cannot be distinguished by any real input — inverting it in the
    // source changed nothing and every test still passed.
    //
    // A rule no data can exercise is a rule that quietly stops holding. These calls
    // construct the collision directly: a name the undocumented map DOES hold, handed a
    // spelling the check declines to interpret. The spelling has to win, or the map has
    // become a second mapping table with weaker rules.
    expect([
      variableTypeOf({ name: 'where', return_type: [{ type: 'string, nil' }] }),
      variableTypeOf({ name: 'sum', return_type: [{ type: 'hash' }] }),
      // ...and with no spelling to defer to, the measurement answers.
      variableTypeOf({ name: 'where' }),
      variableTypeOf({ name: 'sum' }),
      variableTypeOf({ name: 'find' }),
    ]).toEqual(['untyped', 'object', 'array', 'number', 'object']);
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
 * THE SWEEP. Every filter whose docset `return_type` makes this check willing to report,
 * driven through `assign` then `hash_assign` with both kinds of subscript, and settled
 * against what a live instance actually did.
 *
 * WHY ALL OF THEM AND NOT A SAMPLE. 173 filter names reach a reporting type, and this
 * check BLOCKS: a single wrong `return_type` among them is an unappealable refusal of
 * working code. Checking a dozen and finding them all correct says nothing about the
 * other 161, because sampling an accepting population cannot find an over-accepting
 * member. That is the same structural blindness that let twelve fictional names survive
 * in `undocumentedFilters` until a full sweep replaced the spot checks, and it is why
 * this file exists rather than a few more hand-picked cases.
 *
 * 173, NOT 140. Three things separate the docset's row count from the check's reach, and
 * each of them is a way a sweep can look complete while missing names:
 *
 *   140 reporting rows -> 138 names   `map` and `split` are each listed twice
 *   +28 alias names                   `expandAliases` re-emits every entry under each
 *                                     alias, `return_type` included, so `to_json`, `t`,
 *                                     `select`, `sort_by`, `map_attributes` and 23 more
 *                                     are reportable without appearing in filters.json
 *   +7 narrowed / gap-typed names     the date, datetime, time and array-of-arrays
 *                                     spellings, plus the two filters the docset carries
 *                                     no return_type for at all
 *
 * THE MEASUREMENTS ARE NOT MADE HERE. `filter-return-type-oracle.ts` is generated by
 * `scripts/verify-filter-return-types.mjs` against a real instance and committed; this
 * file is hermetic and runs in CI. The two halves are what make the sweep bite:
 *
 *   - the ORACLE says what the runtime does
 *   - this SPEC drives the real check over the real `filters.json`
 *
 * so a docset update that changes a `return_type` fails here instead of quietly changing
 * what the server refuses to write. When it does fail, re-run the generator: the fix is
 * either a corrected mapping in the check or a corrected row in the docset, and the
 * failure names which filter to look at.
 *
 * THE RESULT OF THE FIRST FULL SWEEP was that the docset is right about every one of the
 * 173, aliases and narrowed spellings included. That is a negative result, and it is worth having: the largest
 * unexamined surface in this check turned out to hold no over-accepting entry, and it is
 * now pinned rather than re-argued.
 */

/**
 * Types that make the check REPORT. `object` and `untyped` are the two that never do.
 *
 * Derived from the check's own table rather than restated, so a spelling added there is
 * automatically in scope for the sweep instead of needing this list updated too.
 */
const REPORTING_TYPES: ReadonlySet<string> = new Set<string>(
  [...Object.values(DOCSET_RETURN_TYPES), ...Object.values(DOCSET_RETURN_TYPE_GAPS)].filter(
    (type) => type !== 'object' && type !== 'untyped',
  ),
);

interface DocsetFilter {
  name: string;
  aliases?: string[];
  return_type?: Array<{ type: string }>;
}

/**
 * The reporting filters as the CHECK sees them.
 *
 * Mirrors `AugmentedPlatformOSDocset.filters()`: official entries, then one copy per
 * alias carrying the SAME return type. Order matters — the check builds a Map keyed by
 * name, so the last entry wins, which is also why `map` and `split` appearing twice in
 * `filters.json` collapses rather than conflicts.
 *
 * The undocumented filters the augmentation appends carry no `return_type` at all, so
 * they resolve to `untyped` and report nothing. They are NOT part of this population and
 * are NOT covered by `undocumented-filters.spec.ts` either — that file settles whether
 * the names exist, not what they return. See the dedicated test below, which names them
 * and their measured types so the gap is visible rather than assumed away.
 */
const reportingFromDocset = (): Map<string, string> => {
  const official = filtersJson as DocsetFilter[];
  const aliases = official.flatMap((filter) =>
    (filter.aliases ?? []).map((alias) => ({ ...filter, name: alias })),
  );

  const byName = new Map<string, string>();
  for (const filter of [...official, ...aliases]) {
    // The CHECK'S OWN resolver, not a reimplementation of it. Restating the mapping here
    // would let the sweep agree with a copy of the rules while the real ones drifted.
    const modelled = variableTypeOf(filter);
    if (!REPORTING_TYPES.has(modelled)) continue;
    byName.set(filter.name, modelled);
  }
  return byName;
};

/**
 * The real docset, handed to the check exactly as the runtime would.
 *
 * Deliberately NOT a hand-written mock. A mock proves the check can read a return type;
 * only the shipped data proves it reads THIS return type, for all 173, which is the
 * whole question. It is passed RAW: `runLiquidCheck` goes through the engine's own
 * `check()`, which wraps it in `AugmentedPlatformOSDocset` — so the aliases are expanded
 * by the real code path rather than by anything this file arranges.
 */
const shippedDocset = {
  async filters() {
    return filtersJson;
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

/**
 * Whether the check reports on `{% assign x = 'a' | <name> %}{% hash_assign x[…] %}`.
 *
 * THE ARGUMENTS ARE IRRELEVANT AND THAT IS THE POINT: the check reads the LAST filter's
 * name and looks its return type up in the docset. It never evaluates arguments, so
 * `'a' | ecdh_compute` exercises it identically to the fully-formed call the generator
 * had to build for the runtime — and no key material has to live in this repository.
 *
 * BOTH SHAPES ARE RUN because this check has already had one boundary defect that only
 * one of them could see: a range starts at the defining tag's end offset, and Liquid tags
 * may abut with nothing between them, so `{% assign %}{% hash_assign %}` and the same
 * pair split by a newline took different paths. A sweep that used one shape would have
 * had a blind spot exactly where the last bug was.
 */
const reportsFor = async (name: string, subscript: string): Promise<boolean> => {
  const assign = `{% assign x = 'a' | ${name} %}`;
  const hashAssign = `{% hash_assign x[${subscript}] = 'v' %}`;

  const shapes = await Promise.all(
    [`${assign}${hashAssign}`, `${assign}\n${hashAssign}`].map((source) =>
      runLiquidCheck(InvalidHashAssignTarget, source, 'app/views/partials/file.liquid', {
        platformosDocset: shippedDocset,
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

/**
 * What the runtime did, for a row the transport could not carry an answer for.
 *
 * THREE FILTERS ARE UNMEASURABLE DIRECTLY, and the reason is a property of the probe
 * rather than of the runtime: `ecdh_compute`, `gzip_compress` and `hkdf` all return
 * binary, the runtime's complaint quotes the offending value back, and the resulting
 * response is an HTTP 406 that carries no body at all.
 *
 * They are settled by COMPOSITION rather than assumption, and only where the table
 * itself supports it: every one measured `type_of` as `String`, and every OTHER row that
 * measured `String` was measured raising for both subscripts. So the outcome is read off
 * the rows that share the runtime type — and if those rows ever disagree among
 * themselves, this throws instead of picking one. An inference the data stops supporting
 * must fail loudly, not silently become a guess.
 */
const settledOutcome = (
  row: FilterReturnTypeMeasurement,
  bucket: 'keyAssign' | 'indexAssign',
): RuntimeOutcome => {
  if (row[bucket] !== 'unmeasured') return row[bucket];

  const peers = new Set(
    FILTER_RETURN_TYPE_ORACLE.filter(
      (other) =>
        other.name !== row.name &&
        other.runtimeType === row.runtimeType &&
        other[bucket] !== 'unmeasured',
    ).map((other) => other[bucket]),
  );

  if (peers.size !== 1) {
    throw new Error(
      `${row.name}.${bucket} is unmeasured and cannot be settled: rows with runtimeType ` +
        `"${row.runtimeType}" report ${peers.size === 0 ? 'nothing' : [...peers].join('/')}. ` +
        `Re-run scripts/verify-filter-return-types.mjs or measure this filter directly.`,
    );
  }
  return [...peers][0];
};

describe('Sweep: docset return types vs the runtime, for every reporting filter', () => {
  it('covers exactly the filters the shipped docset makes reportable', async () => {
    // THE TRIPWIRE. The oracle is measured data with a date on it; the docset ships
    // separately and can gain, lose or retype a filter at any time. If those two sets
    // ever differ, every assertion below is silently sweeping the wrong population — so
    // this runs first and names the difference.
    expect([...reportingFromDocset().keys()].sort()).toEqual(
      FILTER_RETURN_TYPE_ORACLE.map((row) => row.name).sort(),
    );
  });

  it('sweeps the alias names too, which appear nowhere in filters.json as filters', async () => {
    // NAMED EXPLICITLY BECAUSE THIS WAS ALMOST MISSED. The sweep was built over
    // `filters.json` and looked complete at 138 names; the check actually sees 173,
    // because `expandAliases` re-emits every entry under each alias with the parent's
    // `return_type` attached. Those 25 names are reportable, blocking, and absent from
    // the docset's own filter list — so a sweep that reads only the docset covers them
    // by accident or not at all.
    //
    // Pinned as a list rather than a count: a new alias on a reporting filter is a new
    // name this check will refuse writes for, and it should arrive as a failure that
    // says which one. Three joined the list when the date/array-of-arrays spellings and
    // the two docset holes were narrowed — `add_to_date`, `parse_csv_rc` and `nl2br`.
    expect(
      FILTER_RETURN_TYPE_ORACLE.filter((row) => row.aliasOf).map(
        (row) => `${row.name} < ${row.aliasOf}`,
      ),
    ).toEqual([
      'add_to_array < array_add',
      'add_to_date < date_add',
      'any < array_any',
      'compact < array_compact',
      'date_before < is_date_before',
      'flatten < array_flatten',
      'in_groups_of < array_in_groups_of',
      'intersection < array_intersect',
      'is_included_in_array < array_include',
      'jwe_encode_rc < jwe_encode',
      'limit < array_limit',
      'map_attributes < array_map',
      'markdownify < markdown',
      'nl2br < new_line_to_br',
      'parse_csv_rc < parse_csv',
      'prepend_to_array < array_prepend',
      'reject < array_reject',
      'rotate < array_rotate',
      'select < array_select',
      'shuffle_array < array_shuffle',
      'sort_by < array_sort_by',
      'subtract_array < array_subtract',
      'sum_array < array_sum',
      't < translate',
      't_escape < translate_escape',
      'to_json < json',
      'to_xml_rc < to_xml',
      'www_form_encode_rc < www_form_encode',
    ]);
  });

  it('resolves every filter to the type the check itself derives, not to a restated rule', async () => {
    // The other half of the tripwire: same names, same MODELLED type. A docset row
    // retyped from `array` to `string` keeps its name and changes what the check refuses,
    // and a mapping edit in `DOCSET_RETURN_TYPES` does the same without touching the
    // docset at all. Both land here, because the right-hand side runs the check's own
    // `variableTypeOf` over the shipped data.
    const modelledNow = reportingFromDocset();
    expect(
      FILTER_RETURN_TYPE_ORACLE.map((row) => ({ name: row.name, modelled: row.modelled })),
    ).toEqual(
      FILTER_RETURN_TYPE_ORACLE.map((row) => ({
        name: row.name,
        modelled: modelledNow.get(row.name),
      })),
    );
  });

  it('fills a type from the gap table ONLY where the docset has no data at all', async () => {
    // AC#3. `DOCSET_RETURN_TYPE_GAPS` is a workaround for missing upstream data, and the
    // danger is that it quietly becomes a second mapping table with weaker rules. Two
    // properties keep it honest, and both are asserted from the shipped docset:
    //
    //   1. every filter it names really does lack return-type data
    //   2. every filter that lacks return-type data is named by it
    //
    // (2) is the one that bites later: if the docset loses a `return_type` for some other
    // filter, that filter silently becomes untyped and this check goes blind to it. If
    // the docs team FIXES these two upstream, (1) fails and tells us to delete the
    // workaround — which is also the outcome we want.
    const official = filtersJson as DocsetFilter[];
    const withAliases = [
      ...official,
      ...official.flatMap((filter) =>
        (filter.aliases ?? []).map((alias) => ({ ...filter, name: alias })),
      ),
    ];

    const holes = withAliases
      .filter(({ return_type: rt }) => !rt || rt.length === 0 || (rt.length === 1 && !rt[0].type))
      .map((filter) => filter.name)
      .sort();

    expect({ holes, gapTable: Object.keys(DOCSET_RETURN_TYPE_GAPS).sort() }).toEqual({
      holes: ['array_index_of', 'new_line_to_br', 'nl2br'],
      gapTable: ['array_index_of', 'new_line_to_br', 'nl2br'],
    });
  });

  it('never refuses a hash_assign the runtime accepts, and never accepts one it refuses', async () => {
    // THE SWEEP ITSELF, in the only form that matters: the check's verdict against the
    // runtime's, for all 173 filters and both subscripts.
    //
    // Asserted as an empty list of disagreements rather than 346 separate expectations,
    // so a failure names every filter at once — a docset regression usually moves a
    // whole spelling, not one entry, and seeing "45 array filters disagree" is a
    // different diagnosis from seeing the first one fail.
    const disagreements: Array<{
      filter: string;
      subscript: string;
      checkReports: boolean;
      runtime: RuntimeOutcome;
    }> = [];

    for (const row of FILTER_RETURN_TYPE_ORACLE) {
      for (const [subscript, bucket] of [
        [`'k'`, 'keyAssign'],
        ['0', 'indexAssign'],
      ] as const) {
        const runtime = settledOutcome(row, bucket);
        const checkReports = await reportsFor(row.name, subscript);

        // `raised` is the runtime refusing the write, which is exactly when this check
        // should report. Anything else is a false block or a false approval.
        if (checkReports !== (runtime === 'raised')) {
          disagreements.push({ filter: row.name, subscript, checkReports, runtime });
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  it('sweeps the whole reportable population, type by type', async () => {
    // Pinned so a SHRINKING sweep is visible. "173 filters checked" reads the same
    // whether the check can report on 173 names or 400, and a sweep that quietly stops
    // covering 45 array filters is exactly the failure this whole file exists to prevent.
    const byModelled: Record<string, number> = {};
    for (const row of FILTER_RETURN_TYPE_ORACLE) {
      byModelled[row.modelled] = (byModelled[row.modelled] ?? 0) + 1;
    }

    expect({ total: FILTER_RETURN_TYPE_ORACLE.length, byModelled }).toEqual({
      total: 173,
      // 138 docset names (140 rows; `map` and `split` are each listed twice), plus 32
      // alias names the augmentation re-emits with the same return type, plus the three
      // filters typed only through DOCSET_RETURN_TYPE_GAPS.
      byModelled: { string: 87, array: 45, number: 19, boolean: 17, date: 3, time: 2 },
    });
  });

  it('groups the date and time spellings the way the runtime does', async () => {
    // The narrowing this sweep was extended for, asserted as data rather than as prose.
    // `datetime` and `time` collapse onto one modelled type because the runtime returns a
    // Time for both — if a future docset spelling were mapped by resemblance instead of
    // by measurement, the row would show up here without a matching runtime type.
    expect(
      FILTER_RETURN_TYPE_ORACLE.filter((row) => row.modelled === 'date' || row.modelled === 'time')
        .map((row) => `${row.name}: ${row.docsetSpelling} -> ${row.modelled} (${row.runtimeType})`)
        .sort(),
    ).toEqual([
      'add_to_date: date -> date (Date)',
      'add_to_time: time -> time (Time)',
      'date_add: date -> date (Date)',
      'to_date: date -> date (Date)',
      'to_time: datetime -> time (Time)',
    ]);
  });

  it('agrees with the runtime about which subscript an Array wants', async () => {
    // The rule the old check did not know, stated as a property of the whole swept
    // population rather than of one hand-picked filter: EVERY array-typed filter must
    // refuse a key and accept an index, and every other reporting type must refuse both.
    // A check that reported "not a Hash" for arrays would satisfy the sweep above for
    // keys while being wrong about every index.
    const shapes = new Set(
      FILTER_RETURN_TYPE_ORACLE.map((row) =>
        [
          row.modelled === 'array' ? 'array' : 'other',
          settledOutcome(row, 'keyAssign'),
          settledOutcome(row, 'indexAssign'),
        ].join('/'),
      ),
    );

    expect([...shapes].sort()).toEqual(['array/raised/rendered', 'other/raised/raised']);
  });
});

describe('Sweep: the filters this check deliberately says nothing about', () => {
  it('lists every spelling it refuses to interpret, and what that silences', async () => {
    // AC#5, and the reason it is worth a test: the silent population is invisible in the
    // check's source, which names only the five spellings it DOES accept. Everything
    // else becomes `untyped` by falling through a `??`. That is the safe direction — a
    // missed detection, never a false block — but a NEW spelling appearing here is a
    // group of filters the check just went blind to, and it should arrive as a failure.
    // Both spellings are here on purpose rather than for want of a measurement. `untyped`
    // describes values whose type depends on what was piped in — `first` of an Array of
    // Hashes is a Hash — and `'string, nil'` is a union. No single probe can establish
    // either, so silence stays the only safe reading. See DOCSET_RETURN_TYPES.
    expect(UNTYPED_RETURN_TYPE_SPELLINGS).toEqual({
      'string, nil': ['l', 'localize'],
      untyped: [
        'array_detect',
        'deep_clone',
        'default',
        'delete_hash_key',
        'detect',
        'dig',
        'fetch',
        'first',
        'hash_delete_key',
        'hash_dig',
        'hash_fetch',
        'last',
        'remove_hash_key',
      ],
    });
  });

  it('covers the UNDOCUMENTED filters too, each behaving as its measured type', async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the change is the point.
    //
    // `AugmentedPlatformOSDocset` appends `UNDOCUMENTED_FILTERS` as bare `{ name }`
    // entries: real filters, proven to exist on an instance, but absent from the docs API
    // and so carrying no `return_type`. Every one resolved to `untyped`, and this check
    // said nothing about any of them — five of the six being types it WOULD report on.
    // That was a real blind spot on names an agent reaches for by habit from Shopify
    // Liquid, and it was pinned here as a known gap rather than left invisible.
    //
    // `verify-undocumented-filters.mjs` now measures each one's return type in the same
    // pass that proves it exists, and `variableTypeOf` resolves it. So the assertion flips
    // from "nothing is reported" to the exact per-filter behaviour:
    //
    //   find        -> hash     silent, and CORRECTLY so — a Hash is a valid target
    //   find_index  -> number   reports on both subscripts
    //   h           -> string   reports on both subscripts
    //   has         -> boolean  reports on both subscripts
    //   sum         -> number   reports on both subscripts
    //   where       -> array    reports on a KEY, silent on an index
    //
    // `find` staying silent is what keeps this honest: a blanket "they all report now"
    // would be wrong, and would mean the type was never really consulted.
    expect([...UNDOCUMENTED_FILTERS]).toEqual(['find', 'find_index', 'h', 'has', 'sum', 'where']);

    const reports = await Promise.all(
      UNDOCUMENTED_FILTERS.flatMap((name) =>
        [`'k'`, '0'].map(async (subscript) => ({
          filter: `${name}[${subscript === '0' ? 'index' : 'key'}]`,
          reports: await reportsFor(name, subscript),
        })),
      ),
    );

    expect(reports).toEqual([
      { filter: 'find[key]', reports: false },
      { filter: 'find[index]', reports: false },
      { filter: 'find_index[key]', reports: true },
      { filter: 'find_index[index]', reports: true },
      { filter: 'h[key]', reports: true },
      { filter: 'h[index]', reports: true },
      { filter: 'has[key]', reports: true },
      { filter: 'has[index]', reports: true },
      { filter: 'sum[key]', reports: true },
      { filter: 'sum[index]', reports: true },
      { filter: 'where[key]', reports: true },
      { filter: 'where[index]', reports: false },
    ]);
  });

  it('gives an undocumented Array filter the INDEX remedy, not the Hash one', async () => {
    // AC#3's "correct remedy for each". `where` returns an Array, so a key subscript must
    // get "use a numeric index" — the same wording every documented Array filter gets.
    // Telling an author to convert it to a Hash would be wrong advice on working code,
    // and is exactly what a type-blind "it reports now" implementation would produce.
    const offenses = await runLiquidCheck(
      InvalidHashAssignTarget,
      `{% assign x = 'a' | where: 'k', 1 %}\n{% hash_assign x['k'] = 'v' %}`,
      'app/views/partials/file.liquid',
      { platformosDocset: shippedDocset },
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      `Cannot use hash_assign on 'x' with a string key, because it is an Array. Use a numeric index instead.`,
    ]);
  });

  it('separates the Hash-typed filters, which are silent because they are VALID targets', async () => {
    // Not the same fact as the list above and must not be read as one. `hash` is a
    // spelling the check RECOGNISES; it maps to `object`, and a Hash is a legitimate
    // hash_assign target, so silence here is a correct verdict rather than ignorance.
    expect(HASH_RETURN_TYPE_FILTERS).toEqual([
      'add_hash_key',
      'array_group_by',
      'assign_to_hash_key',
      'extract_url_params',
      'group_by',
      'hash_add_key',
      'hash_except',
      'hash_merge',
      'hash_sort',
      'jwt_decode',
      'parse_json',
      'parse_xml',
      'to_hash',
      'useragent',
      'video_params',
      'xml_to_hash',
    ]);
  });

  it('reports nothing for an untyped filter, whichever subscript is used', async () => {
    // The silence asserted as BEHAVIOUR, not just as a listing. One representative per
    // unrecognised spelling, both subscripts — the listing above proves the mapping is
    // known, this proves it is honoured.
    const representatives = Object.values(UNTYPED_RETURN_TYPE_SPELLINGS).map((names) => names[0]);

    const reports = await Promise.all(
      representatives.flatMap((name) =>
        [`'k'`, '0'].map(async (subscript) => ({
          filter: name,
          subscript,
          reports: await reportsFor(name, subscript),
        })),
      ),
    );

    expect(reports.filter((entry) => entry.reports)).toEqual([]);
  });
});
