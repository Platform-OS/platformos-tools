import { describe, it, expect } from 'vitest';
import { applySuggestions, MockApp, runLiquidCheck } from '../../test';
import { UnrecognizedRenderPartialArguments } from '.';

function check(partial: string, source: string) {
  return runLiquidCheck(
    UnrecognizedRenderPartialArguments,
    source,
    undefined,
    {},
    {
      'app/views/partials/card.liquid': partial,
    },
  );
}

const defaultPartial = `
  {% doc %}
    @param {string} required_string - A required string
    @param {number} required_number - A required number
    @param {boolean} required_boolean - A required boolean
    @param {object} required_object - A required object
    @param {string} [optional_string] - An optional string
    @param {number} [optional_number] - An optional number
    @param {object} [optional_object] - An optional object
    @param {boolean} [optional_boolean] - An optional boolean
  {% enddoc %}
`;

describe('Module: UnrecognizedRenderPartialParams', () => {
  describe('unknown arguments', () => {
    it('should report unknown arguments that are provided in the render markup', async () => {
      const sourceCode = `
        {% render 'card',
        required_string: 'My Card',
        required_number: 1,
        required_boolean: true,
        required_object: product,
        unknown_param: 'unknown',
        second_unknown_param: 'second unknown',
        %}
        `;
      const offenses = await check(defaultPartial, sourceCode);

      expect(offenses).toHaveLength(2);
      expect(offenses[0].message).toBe(
        "Unknown argument 'unknown_param' in render tag for partial 'card'.",
      );
      expect(offenses[1].message).toBe(
        "Unknown argument 'second_unknown_param' in render tag for partial 'card'.",
      );
    });

    it('should report unknown arguments provided in a function tag', async () => {
      const offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        `{% function a = 'commands/call/fileToCall', variable: 2, extra: 12 %}`,
        undefined,
        {},
        {
          'app/lib/commands/call/fileToCall.liquid': [
            '{% doc %}',
            '  @param {number} variable - param with description',
            '{% enddoc %}',
            '{% assign a = 5 | plus: variable %}',
            '{{ a }}',
          ].join('\n'),
        },
      );

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Unknown argument 'extra' in function tag for partial 'commands/call/fileToCall'.",
      ]);
    });

    it('should not report a globally accessible object passed as an argument', async () => {
      // `context` is in scope inside every partial, so a {% doc %} block has no reason to
      // declare it and passing it is redundant rather than unknown.
      const offenses = await check(
        ['{% doc %}', '  @param {string} title - The card title', '{% enddoc %}'].join('\n'),
        `{% render 'card', title: 'My Card', context: context %}`,
      );

      expect(offenses.map((offense) => offense.message)).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should not report when partial has no doc comment', async () => {
      const sourceCode = `{% render 'card', title: 'My Card' %}`;
      const offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `<h1>This partial has no doc comment</h1>`,
        },
      );

      expect(offenses).toHaveLength(0);
    });

    it('should not report when LiquidDoc definition has no defined params', async () => {
      const sourceCode = `{% render 'card', title: 'My Card' %}`;
      const offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
              {% doc %}
                @description this is a description
                @example this is an example
              {% enddoc %}
              <div>{{ title }}</div>
              <div>{{ description }}</div>
            `,
        },
      );

      expect(offenses).toHaveLength(0);
    });

    it('should not report when partial name is a VariableLookup', async () => {
      const sourceCode = `{% assign partial_name = 'card' %}{% render partial_name, title: 'My Card' %}`;
      const offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
              {% doc %}
                @param {string} title - The title of the card
                @param {string} description - The description of the card
              {% enddoc %}
              <div>{{ title }}</div>
              <div>{{ description }}</div>
            `,
        },
      );

      expect(offenses).toHaveLength(0);
    });

    it('should report when "with/for" alias syntax is used', async () => {
      const mockApp = {
        'app/views/partials/card.liquid': `
          {% doc %}
            @param {string} title - The title of the card
          {% enddoc %}
          <div>{{ title }}</div>
        `,
      } as MockApp;

      let sourceCode = `{% render 'card' with 'my-card' as unknown_param %}`;
      let offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        mockApp,
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Unknown argument 'unknown_param' in render tag for partial 'card'.",
      );
      expect(offenses[0].start.index).toBe(sourceCode.indexOf('with'));
      expect(offenses[0].end.index).toBe(
        sourceCode.indexOf('unknown_param') + 'unknown_param'.length,
      );

      sourceCode = `{% render 'card' for array as unknown_param %}`;
      offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        mockApp,
      );

      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toBe(
        "Unknown argument 'unknown_param' in render tag for partial 'card'.",
      );
      expect(offenses[0].start.index).toBe(sourceCode.indexOf('for'));
      expect(offenses[0].end.index).toBe(
        sourceCode.indexOf('unknown_param') + 'unknown_param'.length,
      );
    });

    it('should correctly suggest removing aliases with variable whitespace', async () => {
      let sourceCode = `{% render 'card' with 'my-card'       as   unknown_param %}`;
      let offenses = await runLiquidCheck(
        UnrecognizedRenderPartialArguments,
        sourceCode,
        undefined,
        {},
        {
          'app/views/partials/card.liquid': `
          {% doc %}
            @param {string} title - The title of the card
          {% enddoc %}
          <div>{{ title }}</div>
        `,
        },
      );

      expect(offenses).toHaveLength(1);
      let result = applySuggestions(sourceCode, offenses[0]);
      expect(result).toEqual([`{% render 'card' %}`]);
    });
  });
});
