import { describe, it, expect } from 'vitest';
import { runLiquidCheck, applySuggestions, messagesOf } from '../../test';
import { ValidRenderPartialArgumentTypes } from '.';
import { Dependencies, FilterEntry } from '../../types';
import { publishedDocset } from '../../test/published-docset';

/**
 * A docset declared HERE, driving the check down a branch — the docset as INPUT, which is one of
 * the two legal shapes for a test in this repository. The subject is what the check does with a
 * published return type; whether the platform really types `append` as `string` is settled where
 * `filters.json` is authored, and a test that restated it would fail on a correct docs release.
 */
function withFilters(filters: FilterEntry[]): Partial<Dependencies> {
  return {
    platformosDocset: {
      async filters() {
        return filters;
      },
      async objects() {
        return [];
      },
      async liquidDrops() {
        return [];
      },
      async liquidDoc() {
        return { annotations: [], param_types: [] };
      },
      async tags() {
        return [];
      },
      async graphQL() {
        return null;
      },
    },
  };
}

const returns = (name: string, type: string, aliases: string[] = []): FilterEntry => ({
  name,
  aliases,
  return_type: [{ type, name: '' }],
});

describe('Module: ValidRenderPartialParamTypes', () => {
  describe('type validation', () => {
    const typeTests = [
      {
        type: 'string',
        validValues: ["'hello'", "''", 'item'],
        invalidValues: [
          { value: '123', actualType: 'number' },
          { value: 'true', actualType: 'boolean' },
        ],
      },
      {
        type: 'number',
        validValues: ['0', '123', '-1', 'item'],
        invalidValues: [
          { value: "'hello'", actualType: 'string' },
          { value: 'true', actualType: 'boolean' },
        ],
      },
      {
        type: 'boolean',
        validValues: ['true', 'false', 'nil', 'empty', 'item', '123', "'hello'"],
        invalidValues: [],
      },
      {
        // `object` is the generic non-primitive type, so it accepts an array and a range too.
        type: 'object',
        validValues: ['item', '(1..3)', '[1, 2]', '[]'],
        invalidValues: [
          { value: "'hello'", actualType: 'string' },
          { value: '123', actualType: 'number' },
          { value: 'true', actualType: 'boolean' },
          { value: 'empty', actualType: 'string' },
        ],
      },
      {
        type: 'array',
        validValues: ['[1, 2]', '["a", "b"]', '[]', 'item'],
        invalidValues: [
          { value: "'hello'", actualType: 'string' },
          { value: '123', actualType: 'number' },
          { value: 'true', actualType: 'boolean' },
          // A range is its own type, not the generic `object` it used to be reported as. Only the
          // MESSAGE moved: `object` still accepts a range (above), `array` still refuses one.
          { value: '(1..3)', actualType: 'range' },
        ],
      },
    ];

    for (const test of typeTests) {
      describe(`${test.type} validation`, () => {
        const makePartial = (type: string) => `
          {% doc %}
            @param {${type}} param - Description
          {% enddoc %}
          <div>{{ param }}</div>
        `;

        test.validValues.forEach((value) => {
          it(`should accept ${value} for ${test.type}`, async () => {
            const sourceCode = `{% render 'card', param: ${value} %}`;
            const offenses = await runLiquidCheck(
              ValidRenderPartialArgumentTypes,
              sourceCode,
              undefined,
              {},
              {
                'app/views/partials/card.liquid': makePartial(test.type),
              },
            );
            expect(offenses).toHaveLength(0);
          });
        });

        test.invalidValues.forEach(({ value, actualType: expectedType }) => {
          it(`should reject ${value} for ${test.type}`, async () => {
            const sourceCode = `{% render 'card', param: ${value} %}`;
            const offenses = await runLiquidCheck(
              ValidRenderPartialArgumentTypes,
              sourceCode,
              undefined,
              {},
              {
                'app/views/partials/card.liquid': makePartial(test.type),
              },
            );
            expect(offenses).toHaveLength(1);
            expect(offenses[0].message).toBe(
              `Type mismatch for argument 'param': expected ${test.type}, got ${expectedType}`,
            );
          });
        });
      });
    }
  });

  /**
   * `date` and `time` are declarable, and this is what that buys.
   *
   * They spent a release publishable as a filter's RETURN type and rejected as a `@param` type, on the
   * stated grounds that nothing infers them for an argument. That was false: `to_date` and `to_time`
   * publish exactly those types, so a filtered argument resolves to one — and until the type could be
   * written down, a literal passed where a date belongs was reported by nothing.
   */
  describe('date and time arguments', () => {
    const partial = (type: string) => ({
      'app/views/partials/card.liquid': `
        {% doc %}
          @param {${type}} on - When it happens
        {% enddoc %}
        <div>{{ on }}</div>
      `,
    });

    // THE REAL `filters.json`, not two entries written here: the claim under test is that a value the
    // platform documents as a `date` satisfies a `@param {date}`, and only the published document can
    // say what `to_date` returns. `filter-semantics.spec.ts` reads the same file the same way.
    const dateFilters = { platformosDocset: publishedDocset };

    it('accepts a value the docset types as a date', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card', on: starts_at | to_date %}`,
        undefined,
        dateFilters,
        partial('date'),
      );

      expect(offenses).toEqual([]);
    });

    it('accepts a value the docset types as a time', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card', on: '' | to_time %}`,
        undefined,
        dateFilters,
        partial('time'),
      );

      expect(offenses).toEqual([]);
    });

    it('rejects a string literal where a date is declared', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card', on: 'yesterday' %}`,
        undefined,
        dateFilters,
        partial('date'),
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'on': expected date, got string",
      ]);
    });

    it('rejects a date where a time is declared, since the two are not the same type', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card', on: starts_at | to_date %}`,
        undefined,
        dateFilters,
        partial('time'),
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'on': expected time, got date",
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle mixed case type annotations', async () => {
      const sourceCode = `{% render 'card', text: "hello", count: 5, flag: true, data: item %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
            {% doc %}
              @param {String} text - The text
              @param {NUMBER} count - The count
              @param {BOOLEAN} flag - The flag
              @param {Object} data - The data
            {% enddoc %}
            <div>{{ text }}{{ count }}{{ flag }}{{ data }}</div>
          `,
        },
      );
      expect(offenses).toHaveLength(0);
    });

    it('should ignore variable lookups', async () => {
      const sourceCode = `{% render 'card', title: item_title %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
            {% doc %}
              @param {String} title - The title
            {% enddoc %}
            <div>{{ title }}</div>
          `,
        },
      );
      expect(offenses).toHaveLength(0);
    });

    it('should not report when partial has no doc comment', async () => {
      const sourceCode = `{% render 'card', title: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `<h1>This partial has no doc comment</h1>`,
        },
      );
      expect(offenses).toHaveLength(0);
    });

    it('should not report null/nil as type mismatch for any type', async () => {
      for (const type of ['string', 'number', 'object', 'boolean']) {
        for (const literal of ['nil', 'null']) {
          const sourceCode = `{% render 'card', param: ${literal} %}`;
          const offenses = await runLiquidCheck(
            ValidRenderPartialArgumentTypes,
            sourceCode,
            undefined,
            {},
            {
              'app/views/partials/card.liquid': `
                {% doc %}
                  @param {${type}} param - Description
                {% enddoc %}
                <div>{{ param }}</div>
              `,
            },
          );
          expect(offenses, `${literal} should be valid for ${type}`).toHaveLength(0);
        }
      }
    });

    it('should not enforce unsupported types', async () => {
      const sourceCode = `{% render 'card', title: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
            {% doc %}
              @param {Unsupported} title - The title
            {% enddoc %}
            <div>{{ title }}</div>
          `,
        },
      );
      expect(offenses).toHaveLength(0);
    });

    it('should not report for unrecognized arguments', async () => {
      const sourceCode = `{% render 'card', title: "hello", unrecognized: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
            {% doc %}
              @param {String} title - The title
            {% enddoc %}
            <div>{{ title }}</div>
          `,
        },
      );
      expect(offenses).toHaveLength(0);
    });

    it('should report when `with` alias is used', async () => {
      const sourceCode = `{% render 'card' with 12 as title %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
          {% doc %}
            @param {String} title - The title
          {% enddoc %}
          <div>{{ title }}</div>
        `,
        },
      );
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Type mismatch for argument 'title': expected string, got number",
      );
    });

    it('should report when `for` alias is used', async () => {
      const sourceCode = `{% render 'card' for 123 as title %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
          {% doc %}
            @param {String} title - The title
          {% enddoc %}
          <div>{{ title }}</div>
        `,
        },
      );
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Type mismatch for argument 'title': expected string, got number",
      );
    });
  });

  describe('filtered arguments are typed from the docset', () => {
    const partial = (type: string) => `
      {% doc %}
        @param {${type}} title - The title
      {% enddoc %}
      <div>{{ title }}</div>
    `;

    const DOCSET = withFilters([
      returns('append', 'string'),
      returns('plus', 'number'),
      returns('translate', 'string', ['t']),
      // Published, and deliberately carrying no return type — the shape of a filter whose type
      // the platform could not state.
      { name: 'mystery', aliases: [] },
    ]);

    const run = (source: string, type: string, deps: Partial<Dependencies> = DOCSET) =>
      runLiquidCheck(ValidRenderPartialArgumentTypes, source, undefined, deps, {
        'app/views/partials/card.liquid': partial(type),
      });

    it('reports a filtered argument whose published return type is wrong', async () => {
      const offenses = await run(`{% render 'card', title: name | append: '!' %}`, 'number');

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'title': expected number, got string",
      ]);
    });

    it('accepts a filtered argument whose published return type matches', async () => {
      const offenses = await run(`{% render 'card', title: name | append: '!' %}`, 'string');

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('lets the LAST filter in a chain decide', async () => {
      const offenses = await run(
        `{% render 'card', title: name | append: '!' | plus: 1 %}`,
        'string',
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'title': expected string, got number",
      ]);
    });

    it('resolves a filter reached through an alias', async () => {
      const offenses = await run(`{% render 'card', title: key | t %}`, 'number');

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'title': expected number, got string",
      ]);
    });

    // The three silences below are each paired with a report above that uses the SAME argument
    // shape, so none of them can pass by the check having stopped looking at filtered arguments.
    it('says nothing when the docset publishes no return type for the filter', async () => {
      const offenses = await run(`{% render 'card', title: name | mystery %}`, 'number');

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('says nothing when the filter is absent from the docset', async () => {
      const offenses = await run(`{% render 'card', title: name | not_a_filter %}`, 'number');

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('says nothing when there is no docset at all', async () => {
      const offenses = await run(`{% render 'card', title: name | append: '!' %}`, 'number', {
        platformosDocset: undefined,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('still says nothing about a bare variable lookup, which has no type here', async () => {
      const offenses = await run(`{% render 'card', title: item_title %}`, 'number');

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('does not report a filtered alias value — the regression that reported correct code', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card' with key | t as title %}`,
        undefined,
        DOCSET,
        { 'app/views/partials/card.liquid': partial('string') },
      );

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('does report a filtered alias value whose published type is wrong', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% render 'card' with n | plus: 1 as title %}`,
        undefined,
        DOCSET,
        { 'app/views/partials/card.liquid': partial('string') },
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'title': expected string, got number",
      ]);
    });
  });

  describe('function call sites', () => {
    const target = `
      {% doc %}
        @param {string} title - The title
      {% enddoc %}
      {% return title %}
    `;

    it('reports a type mismatch at a function call site', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% function res = 'commands/build', title: 123 %}`,
        undefined,
        {},
        { 'app/lib/commands/build.liquid': target },
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'title': expected string, got number",
      ]);
    });

    it('accepts a correctly typed function argument', async () => {
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        `{% function res = 'commands/build', title: 'hello' %}`,
        undefined,
        {},
        { 'app/lib/commands/build.liquid': target },
      );

      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('suggestions', () => {
    const makePartial = (type: string) => `
      {% doc %}
        @param {${type}} param - Description
      {% enddoc %}
      <div>{{ param }}</div>
    `;

    it('should suggest replacing with default value for type or removing value', async () => {
      const sourceCode = `{% render 'card', param: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].suggest).toHaveLength(2);
      expect(offenses[0].suggest?.[0]?.message).toBe("Replace with default value '''' for string");

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', param: '' %}`);

      const suggestions = applySuggestions(sourceCode, offenses[0]);
      expect(suggestions?.[1]).toEqual(`{% render 'card', param:  %}`);
    });

    it('should allow users to fix a single argument when multiple are provided`', async () => {
      const sourceCode = `{% render 'card', title: 123, count: 5 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
          {% doc %}
            @param {string} title - The title
            @param {number} count - The count
          {% enddoc %}
          <div>{{ title }} {{ count }}</div>
        `,
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Type mismatch for argument 'title': expected string, got number",
      );

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', title: '', count: 5 %}`);
    });

    it('should handle arguments with trailing commas', async () => {
      const sourceCode = `{% render 'card', param: 123, %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', param: '', %}`);
    });

    it('should handle arguments with complex spacing', async () => {
      const sourceCode = `{% render 'card',
        title: 123,
        count: 5
      %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
          {% doc %}
            @param {string} title - The title
            @param {number} count - The count
          {% enddoc %}
        `,
        },
      );

      expect(offenses).toHaveLength(1);

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card',
        title: '',
        count: 5
      %}`);
    });

    it('should handle argument with no space after colon', async () => {
      const sourceCode = `{% render 'card', param:123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', param:'' %}`);
    });

    it('should handle argument with multiple spaces after colon', async () => {
      const sourceCode = `{% render 'card', param:     123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', param:     '' %}`);
    });

    it('should handle argument with newlines', async () => {
      const sourceCode = `{% render 'card', param: 
        123 
      %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card', param: 
        '' 
      %}`);
    });

    it('should suggest removal and replacement if expected type has a default value', async () => {
      const sourceCode = `{% render 'card', param: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].suggest).toHaveLength(2);
      expect(offenses[0].suggest?.[0]?.message).toBe("Replace with default value '''' for string");
      expect(offenses[0].suggest?.[1]?.message).toBe('Remove value');
    });

    it("should only suggest removal if expected type default value is ''", async () => {
      const sourceCode = `{% render 'card', param: 123 %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('object'),
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].suggest).toHaveLength(1);
      expect(offenses[0].suggest?.[0]?.message).toBe('Remove value');
    });

    it('should handle when aliases `with` syntax is used', async () => {
      const sourceCode = `{% render 'card' with 123 as param %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Type mismatch for argument 'param': expected string, got number",
      );

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card' with '' as param %}`);
    });

    it('should handle when aliases `for` syntax is used', async () => {
      const sourceCode = `{% render 'card' for 123 as param %}`;
      const offenses = await runLiquidCheck(
        ValidRenderPartialArgumentTypes,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': makePartial('string'),
        },
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Type mismatch for argument 'param': expected string, got number",
      );

      const result = applySuggestions(sourceCode, offenses[0]);
      expect(result?.[0]).toEqual(`{% render 'card' for '' as param %}`);
    });
  });
});
