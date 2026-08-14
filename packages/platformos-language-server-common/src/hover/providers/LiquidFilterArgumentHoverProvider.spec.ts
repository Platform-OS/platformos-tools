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
      '### width\nwidth description\n\n---\n\n[platformOS Reference](https://documentation.platformos.com/api-reference/liquid/filters#width)',
    );
  });
});
