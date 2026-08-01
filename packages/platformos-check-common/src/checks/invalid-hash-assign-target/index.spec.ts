import { describe, it, expect } from 'vitest';
import { InvalidHashAssignTarget } from './index';
import { check, MockApp, runLiquidCheck } from '../../test';
import type { PlatformOSDocset } from '../../types';

describe('Module: InvalidHashAssignTarget', () => {
  it('should report an error when hash_assign is used on a number', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = 10 %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
    expect(offenses[0].message).toContain('hash_assign');
  });

  it('should report an error when hash_assign is used on a string', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = 'hello' %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('string');
  });

  it('should report an error when hash_assign is used on a boolean', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = true %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('boolean');
  });

  it('should report an error when hash_assign is used on a range', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = (1..5) %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    // Was asserted as 'array'. A range is no longer conflated with an Array: an
    // Array accepts `x[0] = ...` and a range was only ever measured raising, so
    // merging them would force a guess in one direction. See VariableType.
    expect(offenses[0].message).toContain('range');
  });

  it('should not report an error when hash_assign is used on an object from parse_json', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an object from parse_json tag', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% parse_json x %}
          {}
        {% endparse_json %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an object from graphql', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% graphql result %}
          query { user { id } }
        {% endgraphql %}
        {% hash_assign result['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an untyped variable', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% hash_assign unknown_var['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on a function return', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% function data = 'lib/get_data' %}
        {% hash_assign data['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on a function return with variable partial', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign partial_name = 'lib/get_data' %}
        {% function data = partial_name %}
        {% hash_assign data['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when function uses hash-access result target and hash_assign follows', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% parse_json my_hash %}{}{% endparse_json %}
        {% function my_hash['result'] = 'lib/get_data' %}
        {% hash_assign my_hash['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should track reassignment and report error on new type', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key1'] = 'value1' %}
        {% assign x = 42 %}
        {% hash_assign x['key2'] = 'value2' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
  });

  it('should handle increment/decrement as numbers', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% increment counter %}
        {% hash_assign counter['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
  });

  it('should handle capture as string', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% capture x %}hello{% endcapture %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('string');
  });

  it('should allow multiple hash_assign on same object', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key1'] = 'value1' %}
        {% hash_assign x['key2'] = 'value2' %}
        {% hash_assign x['key3'] = 'value3' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
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
        // Ships with NO return_type — the real docset has exactly one such filter.
        { name: 'new_line_to_br' },
        // Present, but with a spelling this check deliberately refuses to interpret.
        { name: 'to_time', return_type: [{ type: 'time' }] },
        { name: 'first_or_nil', return_type: [{ type: 'string, nil' }] },
      ];
    },
  } as unknown as PlatformOSDocset;

  const offensesIn = async (source: string) =>
    (
      await runLiquidCheck(InvalidHashAssignTarget, source, 'file.liquid', {
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
    // AC#3. Three ways to be unknown, all of which must produce nothing: a filter the
    // docset does not list at all, one it lists with no `return_type`, and two whose
    // return type is spelled in a way this check refuses to interpret rather than
    // resemble-match (`time`, `string, nil`).
    expect([
      await offensesIn(`{% assign x = 'a' | not_in_the_docset %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | new_line_to_br %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | to_time %}\n{% hash_assign x['k'] = 'v' %}`),
      await offensesIn(`{% assign x = 'a' | first_or_nil %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([[], [], [], []]);
  });

  it('still reports every primitive the runtime raises on', async () => {
    // AC#4. The fix must not trade one false block for false approvals; these four
    // were all confirmed raising `HashAssignTagError`.
    expect(
      (
        await Promise.all([
          offensesIn(`{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}`),
          offensesIn(`{% assign x = 'hi' %}\n{% hash_assign x['k'] = 'v' %}`),
          offensesIn(`{% assign x = true %}\n{% hash_assign x['k'] = 'v' %}`),
          offensesIn(`{% assign x = (1..3) %}\n{% hash_assign x['k'] = 'v' %}`),
        ])
      ).map(([offense]) => offense?.message),
    ).toEqual([
      expectsHashOrArray('x', 'number'),
      expectsHashOrArray('x', 'string'),
      expectsHashOrArray('x', 'boolean'),
      expectsHashOrArray('x', 'range'),
    ]);
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
        await runLiquidCheck(InvalidHashAssignTarget, source, 'file.liquid', {
          platformosDocset: undefined,
        })
      ).map((offense) => offense.message);

    expect([
      await withoutDocset(`{% assign x = 'a' | upcase %}\n{% hash_assign x['k'] = 'v' %}`),
      await withoutDocset(`{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}`),
    ]).toEqual([[], [expectsHashOrArray('x', 'number')]]);
  });
});
