import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('Module: LiquidFilterArgumentHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [
          {
            name: 'with_options',
            platformOS: true,
            syntax: 'string | with_options',
            description: 'with_options description',
            parameters: [
              {
                name: 'width',
                description: 'width description',
                types: ['number'],
                positional: false,
                required: false,
              },
              {
                name: 'crop',
                description: 'crop description',
                types: ['string'],
                positional: false,
                required: true,
                default: 'center',
              },
            ],
            return_type: [{ type: 'string', name: '' }],
          },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        liquidDoc: async () => ({ annotations: [], param_types: [] }),
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
    );
  });

  it('should return nothing if the filter is unknown', async () => {
    await expect(provider).to.hover(`{{ foo | not_a_filter: wid█th: 1000 }}`, null);
  });

  it('should return nothing if the parameter is unknown', async () => {
    await expect(provider).to.hover(`{{ foo | with_options: pig█eons: 1000 }}`, null);
  });

  it('should return the hover description of parameter', async () => {
    await expect(provider).to.hover(
      `{{ foo | with_options: wid█th: 1000 }}`,
      [
        '### width: `number`',
        'width description',
        '',
        '---',
        '',
        // The FILTER's page. Rendered as a docset entry, the parameter advertised
        // `…/liquid/filters#width`, which is where a filter named `width` would be documented.
        '[platformOS Reference](https://documentation.platformos.com/api-reference/liquid/platformos-filters#with-options)',
      ].join('\n'),
    );
  });

  it('should state that the parameter is required and what it defaults to', async () => {
    await expect(provider).to.hover(
      `{{ foo | with_options: cr█op: 'center' }}`,
      [
        '### crop: `string`',
        'crop description',
        '',
        '*required*, *default:* `center`',
        '',
        '---',
        '',
        '[platformOS Reference](https://documentation.platformos.com/api-reference/liquid/platformos-filters#with-options)',
      ].join('\n'),
    );
  });
});
