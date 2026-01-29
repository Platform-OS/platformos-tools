import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { MetafieldDefinitionMap } from '@platformos/platformos-check-common';
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
            name: 'image_url',
            syntax: 'string | image_url',
            description: 'image_url description',
            parameters: [
              {
                name: 'width',
                description: 'width description',
                types: ['number'],
                positional: false,
                required: false,
              },
            ],
            return_type: [{ type: 'string', name: '' }],
          },
        ],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      new TranslationProvider(new MockFileSystem({})),
      async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    );
  });

  it('should return nothing if the filter is unknown', async () => {
    await expect(provider).to.hover(`{{ foo | not_a_filter: wid█th: 1000 }}`, null);
  });

  it('should return nothing if the parameter is unknown', async () => {
    await expect(provider).to.hover(`{{ foo | image_url: pig█eons: 1000 }}`, null);
  });

  it('should return the hover description of parameter', async () => {
    await expect(provider).to.hover(
      `{{ foo | image_url: wid█th: 1000 }}`,
      '### width\nwidth description\n\n---\n\n[platformos Reference](https://documentation.platformos.com/api-reference/liquid/filters#width)',
    );
  });
});
