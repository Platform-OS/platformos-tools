import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';

import { GetDocDefinitionForURI, DocDefinition } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

const uri = 'file:///app/views/partials/product-card.liquid';

describe('Module: RenderPartialParameterHoverProvider', async () => {
  let provider: HoverProvider;
  let getPartialDefinition: GetDocDefinitionForURI;
  const mockPartialDefinition: DocDefinition = {
    uri,
    liquidDoc: {
      parameters: [
        {
          name: 'title',
          description: 'The title of the product',
          type: 'string',
          required: true,
          nodeType: 'param',
        },
      ],
    },
  };

  describe('hover', () => {
    beforeEach(() => {
      provider = createProvider(async () => mockPartialDefinition);
    });

    it('should return null if doc definition not found', async () => {
      getPartialDefinition = async () => undefined;
      provider = createProvider(getPartialDefinition);
      await expect(provider).to.hover(`{% render 'product-card' tit█le: 'value' %}`, null);
    });

    it('should return null if parameter not found in doc definition', async () => {
      await expect(provider).to.hover(`{% render 'product-card' unknown-para█m: 'value' %}`, null);
    });

    it('should return parameter info from doc definition', async () => {
      await expect(provider).to.hover(
        `{% render 'product-card' ti█tle: 'My Product' %}`,
        '### `title`: string\n\nThe title of the product',
      );
    });
  });
});

const createProvider = (getPartialDefinition: GetDocDefinitionForURI) => {
  return new HoverProvider(
    new DocumentManager(),
    {
      graphQL: async () => null,
      filters: async () => [],
      objects: async () => [],
      liquidDrops: async () => [],
      tags: async () => [],
    },
    new TranslationProvider(new MockFileSystem({})),
    async () => ({}),
    getPartialDefinition,
  );
};
