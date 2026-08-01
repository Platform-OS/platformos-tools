import { describe, it, expect } from 'vitest';
import { InvalidHashAssignTarget } from './index';
import { check, MockApp, runLiquidCheck } from '../../test';

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

  it('should report an error when hash_assign is used on an array (range)', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = (1..5) %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('array');
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
    `Cannot use hash_assign on '${name}' which is ${kind}. hash_assign can only be used on object types.`;

  const HASH_ASSIGN = "{% hash_assign x['k'] = 'v' %}";

  it('reports the same defect however the two tags are separated', async () => {
    // The agreement property, stated in one place: separation is formatting, not
    // meaning, so all three shapes must produce the same finding. Only the span
    // moves, and it moves exactly as much as the separator.
    const assign = '{% assign x = 5 %}';
    const message = cannotUse('x', 'a number');

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
          message: cannotUse('x', 'a number'),
          start: { line: 0, character: 33 },
          end: { line: 0, character: 39 },
        },
      ],
      [
        {
          message: cannotUse('x', 'a string'),
          start: { line: 0, character: 36 },
          end: { line: 0, character: 42 },
        },
      ],
      [
        {
          message: cannotUse('x', 'a boolean'),
          start: { line: 0, character: 36 },
          end: { line: 0, character: 42 },
        },
      ],
      [
        {
          message: cannotUse('x', 'an array'),
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
          message: cannotUse('x', 'a string'),
          start: { line: 0, character: 48 },
          end: { line: 0, character: 54 },
        },
      ],
      [
        {
          message: cannotUse('c', 'a number'),
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
        message: cannotUse('x', 'a number'),
        start: { line: 0, character: 95 },
        end: { line: 0, character: 101 },
      },
    ]);
  });
});
