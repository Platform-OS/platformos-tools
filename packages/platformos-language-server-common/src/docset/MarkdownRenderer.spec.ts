import { describe, it, expect } from 'vitest';

import { render, renderHtmlEntry, renderParameter, type HtmlEntry } from './MarkdownRenderer';
import { publishedDocset } from '@platformos/platformos-check-common/src/test';
import type { DocsetEntry, FilterEntry } from '@platformos/platformos-check-common';

const DOC_ENTRY: DocsetEntry = {
  name: 'entry',
  summary: 'summary',
  description: 'description',
  deprecated: false,
};

/**
 * An entry with ONE sentence, so a case about parameters or examples cannot pass or fail for the
 * separate reason that the summary and the description are the same.
 */
const SINGLE_PROSE: DocsetEntry = {
  name: 'entry',
  description: 'prose',
  deprecated: false,
};

const HTML_ENTRY: HtmlEntry = {
  name: 'entry',
  description: 'description',
};

describe('MarkdownRenderer', () => {
  describe('render()', () => {
    it('converts a docset entry to markdown', async () => {
      expect(render(DOC_ENTRY)).toEqual(`### entry\nsummary\n\ndescription`);
    });

    describe('when the summary and the description are the same sentence', () => {
      it('renders the sentence once', async () => {
        expect(render({ ...DOC_ENTRY, description: 'summary' })).toEqual(`### entry\nsummary`);
      });
    });

    describe('when the entry has syntax', () => {
      it('includes the syntax in the markdown', async () => {
        expect(render({ ...DOC_ENTRY, syntax: 'string | strip' })).toEqual(
          `### entry\n\`\`\`liquid\n{{ string | strip }}\n\`\`\`\n\nsummary\n\ndescription`,
        );
      });

      describe('and the syntax already includes liquid tags', () => {
        it('does not wrap the syntax in curly braces', async () => {
          expect(render({ ...DOC_ENTRY, syntax: '{% form %}' })).toEqual(
            `### entry\n\`\`\`liquid\n{% form %}\n\`\`\`\n\nsummary\n\ndescription`,
          );
        });
      });
    });

    describe('when the entry has parameters', () => {
      it('lists them, splitting the named arguments out from the positional ones', async () => {
        const entry: FilterEntry = {
          ...SINGLE_PROSE,
          parameters: [
            {
              name: 'input',
              description: 'the value',
              types: ['string'],
              required: true,
              positional: true,
            },
            {
              name: 'options',
              description: 'the options',
              types: ['object'],
              required: false,
              positional: true,
              default: '{}',
            },
            {
              name: 'locale',
              description: 'which locale\nto use',
              types: ['string'],
              required: false,
              positional: false,
            },
          ],
        };

        expect(render(entry)).toEqual(
          [
            '### entry',
            'prose',
            '',
            '**Parameters**',
            '',
            '- `input` `string` *required* — the value',
            '- `options` `object` *default:* `{}` — the options',
            '',
            '**Named arguments**',
            '',
            '- `locale:` `string` — which locale to use',
          ].join('\n'),
        );
      });

      describe('and the docset says the named arguments are not all of them', () => {
        it('says so', async () => {
          const entry: FilterEntry = {
            ...SINGLE_PROSE,
            named_parameters_exhaustive: false,
            parameters: [
              {
                name: 'locale',
                description: 'which locale to use',
                types: ['string'],
                required: false,
                positional: false,
              },
            ],
          };

          expect(render(entry)).toEqual(
            [
              '### entry',
              'prose',
              '',
              '**Named arguments**',
              '',
              '- `locale:` `string` — which locale to use',
              '',
              'This filter accepts other named arguments than the ones listed above.',
            ].join('\n'),
          );
        });
      });

      describe('and the docset says the named arguments ARE all of them', () => {
        it('does not say the list is open', async () => {
          const entry: FilterEntry = {
            ...SINGLE_PROSE,
            named_parameters_exhaustive: true,
            parameters: [
              {
                name: 'locale',
                description: 'which locale to use',
                types: ['string'],
                required: false,
                positional: false,
              },
            ],
          };

          expect(render(entry)).toEqual(
            [
              '### entry',
              'prose',
              '',
              '**Named arguments**',
              '',
              '- `locale:` `string` — which locale to use',
            ].join('\n'),
          );
        });
      });
    });

    describe('when the entry says what it returns', () => {
      it('renders the description beside the type', async () => {
        const entry: FilterEntry = {
          ...SINGLE_PROSE,
          return_type: [
            { type: 'string', name: '', description: 'the stripped\nvalue' },
          ] as FilterEntry['return_type'],
        };

        expect(render(entry)).toEqual(
          ['### entry: `string`', 'prose', '', '**Returns** `string` — the stripped value'].join(
            '\n',
          ),
        );
      });

      describe('and it returns an array of nothing in particular', () => {
        it('names the type `array` rather than `[]`', async () => {
          const entry: FilterEntry = {
            ...SINGLE_PROSE,
            return_type: [
              { type: 'array', name: '', array_value: '', description: 'the parts' },
            ] as FilterEntry['return_type'],
          };

          expect(render(entry)).toEqual(
            ['### entry: `array`', 'prose', '', '**Returns** `array` — the parts'].join('\n'),
          );
        });
      });
    });

    describe('when the entry has examples', () => {
      it('renders them verbatim in one liquid fence', async () => {
        // `&lt;p&gt;` stays escaped: the reference page renders `{{ e.raw_liquid }}` and escapes it
        // again, and for `parse_json` and `html_safe` the entity IS what the example demonstrates.
        const entry: DocsetEntry = {
          ...SINGLE_PROSE,
          examples: [
            { raw_liquid: "{{ 'a' | entry }}" },
            { raw_liquid: '{{ &lt;p&gt; | entry }}' },
          ],
        };

        expect(render(entry)).toEqual(
          [
            '### entry',
            'prose',
            '',
            '**Examples**',
            '',
            '```liquid',
            "{{ 'a' | entry }}",
            '{{ &lt;p&gt; | entry }}',
            '```',
          ].join('\n'),
        );
      });

      describe('and one of them spans several lines', () => {
        it('separates them with a blank line', async () => {
          const entry: DocsetEntry = {
            ...SINGLE_PROSE,
            examples: [
              { raw_liquid: '{% entry %}\n  body\n{% endentry %}' },
              { raw_liquid: "{{ 'a' | entry }}" },
            ],
          };

          expect(render(entry)).toEqual(
            [
              '### entry',
              'prose',
              '',
              '**Examples**',
              '',
              '```liquid',
              '{% entry %}',
              '  body',
              '{% endentry %}',
              '',
              "{{ 'a' | entry }}",
              '```',
            ].join('\n'),
          );
        });
      });
    });

    describe('when the entry is deprecated', () => {
      it('names the successor rather than printing the reason', async () => {
        const entry: FilterEntry = {
          ...SINGLE_PROSE,
          deprecated: true,
          deprecation_reason: '[any](#any) filter',
          deprecation_replacement: 'any',
        };

        expect(render(entry)).toEqual(
          ['### entry', '**Deprecated** — use `any` instead.', '', 'prose'].join('\n'),
        );
      });

      describe('and no successor is published', () => {
        it('falls back to the reason', async () => {
          const entry: FilterEntry = {
            ...SINGLE_PROSE,
            deprecated: true,
            deprecation_reason: 'use the built in `newline_to_br` filter',
          };

          expect(render(entry)).toEqual(
            [
              '### entry',
              '**Deprecated** — use the built in `newline_to_br` filter',
              '',
              'prose',
            ].join('\n'),
          );
        });
      });
    });
  });

  describe('renderParameter()', () => {
    it('titles the parameter with its type and links the filter it belongs to', async () => {
      const parameter = {
        name: 'locale',
        description: 'which locale to use',
        types: ['string'],
        required: false,
      };

      expect(renderParameter(parameter, { name: 't', platformOS: true } as FilterEntry)).toEqual(
        [
          '### locale: `string`',
          'which locale to use',
          '',
          '---',
          '',
          '[platformOS Reference](https://documentation.platformos.com/api-reference/liquid/platformos-filters#t)',
        ].join('\n'),
      );
    });

    it('states that the parameter is required and what it defaults to', async () => {
      const parameter = {
        name: 'options',
        description: 'the options',
        types: ['object'],
        required: true,
        default: '{}',
      };

      expect(renderParameter(parameter)).toEqual(
        ['### options: `object`', 'the options', '', '*required*, *default:* `{}`'].join('\n'),
      );
    });
  });

  describe('renderHtmlEntry()', () => {
    it('converts a docset entry to markdown', async () => {
      expect(renderHtmlEntry(HTML_ENTRY)).toEqual(`### entry\ndescription`);
    });
  });

  /**
   * Properties of the rendering of the REAL documents, derived from them and never restating them.
   *
   * A hand-written entry can only prove the renderer agrees with whoever wrote it, and it did not: the
   * mock here has a distinct summary and description, so the duplication that every one of the 176
   * shipped filters displayed was invisible to this file for as long as it existed.
   */
  describe('against the published docset', () => {
    it('renders each filter description exactly once', async () => {
      const filters = await publishedDocset.filters();

      const twice = filters.filter((filter) => {
        const description = filter.description?.trim();
        if (!description) return false;

        return render(filter, undefined, 'filter').split(description).length > 2;
      });

      expect(twice.map((filter) => filter.name)).toEqual([]);
    });

    it('titles every filter with a type a reader can name', async () => {
      const filters = await publishedDocset.filters();

      const untitled = filters.filter((filter) => {
        const [title] = render(filter, undefined, 'filter').split('\n');

        return title.includes('`[]`') || title.includes('`Array<>`');
      });

      expect(untitled.map((filter) => filter.name)).toEqual([]);
    });

    it('lists the named arguments of every filter that publishes one', async () => {
      const filters = await publishedDocset.filters();

      const missing = filters
        .filter((filter) => filter.parameters?.some((parameter) => parameter.positional === false))
        .filter((filter) => !render(filter, undefined, 'filter').includes('**Named arguments**'));

      expect(missing.map((filter) => filter.name)).toEqual([]);
    });

    /**
     * The control. `translate` genuinely accepts named arguments, so a spec that only ever asserts a
     * section is PRESENT would pass with the split deleted and every argument listed as positional.
     */
    it('gives a filter with no named argument no named-argument section', async () => {
      const filters = await publishedDocset.filters();

      const spurious = filters
        .filter((filter) => !filter.parameters?.some((parameter) => parameter.positional === false))
        .filter((filter) => render(filter, undefined, 'filter').includes('**Named arguments**'));

      expect(spurious.map((filter) => filter.name)).toEqual([]);
    });
  });
});
