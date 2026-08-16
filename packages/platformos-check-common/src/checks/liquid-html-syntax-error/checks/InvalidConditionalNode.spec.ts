import { expect, describe, it } from 'vitest';
import { applyFix, messagesOf, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';

/**
 * Message and FIXED SOURCE, whole, for every case.
 */
const stopsAt = (value: string, ignored: string) =>
  `Syntax is not supported: Expression stops at truthy value '${value}', and will ignore: '${ignored}'`;

const cannotStartWith = (token: string) =>
  `Syntax is not supported: Conditional cannot start with '${token}'. Use a variable or value instead`;

const anythingAfter = (kept: string) =>
  `Syntax is not supported: Conditional is invalid. Anything after '${kept}' will be ignored`;

/** The offense messages, and the source each offense's own fix produces. */
async function report(source: string) {
  const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

  return {
    messages: messagesOf(offenses),
    fixes: offenses.map((offense) => applyFix(source, offense)),
  };
}

/** `report` over a table, keyed by source so a failure names the case that broke. */
async function reportAll(sources: string[]) {
  const entries = await Promise.all(sources.map(async (s) => [s, await report(s)] as const));
  return Object.fromEntries(entries);
}

/** The expected entry for a source that must produce no offense and so no fix. */
const SILENT = { messages: [], fixes: [] };

describe('Module: InvalidConditionalBooleanExpression', () => {
  it('should not report an offense for valid boolean expressions', async () => {
    const sources = [
      '{% if 1 > 2 %}hello{% endif %}',
      '{% if variable == 5 %}hello{% endif %}',
      "{% if 'abc' contains 'a' %}hello{% endif %}",
      "{% if item.title != '' %}hello{% endif %}",
      '{% if 1 and 2 %}hello{% endif %}',
      '{% if true or false %}hello{% endif %}',
      '{% if 10 > 5 and user.active %}hello{% endif %}',
      '{% if price >= 100 or discount %}hello{% endif %}',
      "{% if user.name contains 'admin' or user.role == 'owner' %}hello{% endif %}",
    ];

    expect(await reportAll(sources)).toEqual(Object.fromEntries(sources.map((s) => [s, SILENT])));
  });

  it('should not report an offense for valid single values', async () => {
    const sources = [
      '{% if variable %}hello{% endif %}',
      '{% if user.active %}hello{% endif %}',
      '{% if true %}hello{% endif %}',
      '{% if false %}hello{% endif %}',
      '{% if 1 %}hello{% endif %}',
      '{% if 0 %}hello{% endif %}',
      "{% if 'string' %}hello{% endif %}",
      // `contains` is an operator name, and a bare one is a variable like any other.
      '{% if contains %}hello{% endif %}',
    ];

    expect(await reportAll(sources)).toEqual(Object.fromEntries(sources.map((s) => [s, SILENT])));
  });

  it('should report an offense when the expression stops at a truthy value', async () => {
    const numbers = await report('{% if 7 1 > 100 %}hello{% endif %}');
    const strings = await report("{% if 'hello' 1 > 100 %}world{% endif %}");

    expect({ numbers, strings }).toEqual({
      numbers: {
        messages: [stopsAt('7', '1 > 100')],
        fixes: ['{% if 7 %}hello{% endif %}'],
      },
      strings: {
        messages: [stopsAt("'hello'", '1 > 100')],
        fixes: ["{% if 'hello' %}world{% endif %}"],
      },
    });
  });

  it('should report an offense when parser stops at liquid literals', async () => {
    const cases = [
      { source: '{% if true 1 > 0 %}hello{% endif %}', value: 'true', ignored: '1 > 0' },
      { source: '{% if false 1 > 0 %}hello{% endif %}', value: 'false', ignored: '1 > 0' },
      { source: '{% if nil 6 > 5 %}hello{% endif %}', value: 'nil', ignored: '6 > 5' },
      { source: '{% if empty 123 456 %}hello{% endif %}', value: 'empty', ignored: '123 456' },
      { source: '{% if blank 789 %}hello{% endif %}', value: 'blank', ignored: '789' },
    ];

    expect(await reportAll(cases.map((c) => c.source))).toEqual(
      Object.fromEntries(
        cases.map((c) => [
          c.source,
          {
            messages: [stopsAt(c.value, c.ignored)],
            fixes: [`{% if ${c.value} %}hello{% endif %}`],
          },
        ]),
      ),
    );
  });

  it('should report offenses in different liquid tag types', async () => {
    const ifTag = '{% if 7 1 > 100 %}hello{% endif %}';
    const unlessTag = "{% unless 'test' 42 > 0 %}hello{% endunless %}";
    const elsifBranch = '{% if false %}no{% elsif 7 1 > 100 %}hello{% endif %}';

    expect(await reportAll([ifTag, unlessTag, elsifBranch])).toEqual({
      [ifTag]: {
        messages: [stopsAt('7', '1 > 100')],
        fixes: ['{% if 7 %}hello{% endif %}'],
      },
      [unlessTag]: {
        messages: [stopsAt("'test'", '42 > 0')],
        fixes: ["{% unless 'test' %}hello{% endunless %}"],
      },
      [elsifBranch]: {
        messages: [stopsAt('7', '1 > 100')],
        fixes: ['{% if false %}no{% elsif 7 %}hello{% endif %}'],
      },
    });
  });

  it('should report an offense for a conditional that starts with an operator or symbol', async () => {
    // Every one of these is fixed the same way — to `false`, the only safe reading of a
    // condition with no operand — which is the part the substring assertions never checked.
    const tokens = ['>', '==', '<', '!=', '>=', '<=', '@', '#', '$', '&'];
    const sources = tokens.map((token) => `{% if ${token} %}hello{% endif %}`);

    expect(await reportAll(sources)).toEqual(
      Object.fromEntries(
        tokens.map((token) => [
          `{% if ${token} %}hello{% endif %}`,
          {
            messages: [cannotStartWith(token)],
            fixes: ['{% if false %}hello{% endif %}'],
          },
        ]),
      ),
    );
  });

  it('should report an offense for malformed expressions in complex expressions', async () => {
    const cases = [
      { source: '{% if > 5 and true %}hello{% endif %}', token: '>' },
      { source: '{% if == 2 or false %}hello{% endif %}', token: '==' },
      { source: '{% if < 10 and variable %}hello{% endif %}', token: '<' },
    ];

    expect(await reportAll(cases.map((c) => c.source))).toEqual(
      Object.fromEntries(
        cases.map((c) => [
          c.source,
          {
            messages: [cannotStartWith(c.token)],
            fixes: ['{% if false %}hello{% endif %}'],
          },
        ]),
      ),
    );
  });

  it('should report an offense for trailing tokens after a comparison', async () => {
    const cases = [
      { source: '{% if 1 == 2 foobar %}hello{% endif %}', kept: '1 == 2' },
      { source: '{% if 10 > 4 baz qux %}hello{% endif %}', kept: '10 > 4' },
      { source: "{% if 'abc' contains 'a' noise %}hello{% endif %}", kept: "'abc' contains 'a'" },
      { source: '{% if price <= 50 extra %}hello{% endif %}', kept: 'price <= 50' },
      { source: '{% if count != 0 junk %}hello{% endif %}', kept: 'count != 0' },
    ];

    expect(await reportAll(cases.map((c) => c.source))).toEqual(
      Object.fromEntries(
        cases.map((c) => [
          c.source,
          {
            messages: [anythingAfter(c.kept)],
            fixes: [`{% if ${c.kept} %}hello{% endif %}`],
          },
        ]),
      ),
    );
  });

  it('should report an offense for malformed comparisons like missing quotes', async () => {
    const cases = [
      // A missing closing quote makes the REST of the tag part of the string, so what the
      // platform keeps is not what the author sees. That is the case worth pinning exactly.
      {
        source: "{% if 'wat' == 'squat > 2 %}hello{% endif %}",
        kept: "'wat' == 'squat",
        fixed: "{% if 'wat' == 'squat %}hello{% endif %}",
      },
      {
        source: "{% if 'wat' == 'squat' > 2 %}hello{% endif %}",
        kept: "'wat' == 'squat'",
        fixed: "{% if 'wat' == 'squat' %}hello{% endif %}",
      },
      {
        source: "{% if price == 'test' != 5 %}hello{% endif %}",
        kept: "price == 'test'",
        fixed: "{% if price == 'test' %}hello{% endif %}",
      },
    ];

    expect(await reportAll(cases.map((c) => c.source))).toEqual(
      Object.fromEntries(
        cases.map((c) => [c.source, { messages: [anythingAfter(c.kept)], fixes: [c.fixed] }]),
      ),
    );
  });

  it('should not report an offense for valid logical continuations', async () => {
    const sources = [
      '{% if 1 > 0 and 2 < 3 %}hello{% endif %}',
      '{% if x == 5 or y != 10 %}hello{% endif %}',
      '{% if price >= 100 and discount %}hello{% endif %}',
    ];

    expect(await reportAll(sources)).toEqual(Object.fromEntries(sources.map((s) => [s, SILENT])));
  });

  /**
   * The `&&`/`||` HINT, on both branches that append it.
   */
  describe('the &&/|| hint', () => {
    const LOGICAL_HINT = ". Use 'and'/'or' instead of '&&'/'||' for multiple conditions";

    const cases = [
      {
        label: 'after a truthy literal',
        source: '{% if true && false %}hello{% endif %}',
        message: stopsAt('true', '&& false') + LOGICAL_HINT,
        fixed: '{% if true %}hello{% endif %}',
        control: '{% if true and false %}hello{% endif %}',
      },
      {
        label: 'after a truthy literal, || spelling',
        source: '{% if true || false %}hello{% endif %}',
        message: stopsAt('true', '|| false') + LOGICAL_HINT,
        fixed: '{% if true %}hello{% endif %}',
        control: '{% if true or false %}hello{% endif %}',
      },
      {
        label: 'after a complete comparison',
        source: '{% if 1 == 1 && 2 == 2 %}hello{% endif %}',
        message: anythingAfter('1 == 1') + LOGICAL_HINT,
        fixed: '{% if 1 == 1 %}hello{% endif %}',
        control: '{% if 1 == 1 and 2 == 2 %}hello{% endif %}',
      },
      {
        label: 'after a complete comparison, || spelling',
        source: '{% if 1 == 1 || 2 == 2 %}hello{% endif %}',
        message: anythingAfter('1 == 1') + LOGICAL_HINT,
        fixed: '{% if 1 == 1 %}hello{% endif %}',
        control: '{% if 1 == 1 or 2 == 2 %}hello{% endif %}',
      },
    ];

    it('explains the operator, on both branches that can append the hint', async () => {
      expect(await reportAll(cases.map((c) => c.source))).toEqual(
        Object.fromEntries(
          cases.map((c) => [c.source, { messages: [c.message], fixes: [c.fixed] }]),
        ),
      );
    });

    it('CONTROL: says nothing about the same conditions spelled with and/or', async () => {
      const controls = cases.map((c) => c.control);

      expect(await reportAll(controls)).toEqual(
        Object.fromEntries(controls.map((s) => [s, SILENT])),
      );
    });
  });

  /**
   * A FILTER IN A CONDITION CARRIES NO FIX, and that is a decision rather than an omission. The
   * repair needs an `{% assign %}` on a PRECEDING line, which a `StringCorrector` replacing one
   * range cannot express, and `fix: <lhs>` — the natural next edit — would change WHAT THE
   * CONDITION TESTS while `checkAndAutofix` applies safe fixes without asking.
   */
  it('offers NO autofix for a filter in a condition, in every form that reports one', async () => {
    const sources = [
      `{% if 'a' | upcase == 'A' %}hello{% endif %}`,
      `{% unless 'a' | upcase == 'A' %}hello{% endunless %}`,
      // The truthy form, which reached this diagnostic by a different route.
      `{% if 'a' | upcase %}hello{% endif %}`,
    ];

    const found = await Promise.all(
      sources.map(async (source) => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
        return [source, offenses.map((offense) => offense.fix)];
      }),
    );

    // One offense each, and its `fix` is absent — not merely a fix that does nothing.
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(sources.map((source) => [source, [undefined]])),
    );
  });
});
