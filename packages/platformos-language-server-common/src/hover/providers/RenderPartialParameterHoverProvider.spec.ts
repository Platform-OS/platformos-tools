import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';

import { GetDocDefinitionForURI, DocDefinition } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem, publishedDocset } from '@platformos/platformos-check-common/src/test';

const uri = 'file:///app/views/partials/item-card.liquid';

describe('Module: RenderPartialParameterHoverProvider', async () => {
  let provider: HoverProvider;
  let getPartialDefinition: GetDocDefinitionForURI;
  const mockPartialDefinition: DocDefinition = {
    uri,
    liquidDoc: {
      parameters: [
        {
          name: 'title',
          description: 'The title of the item',
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
      await expect(provider).to.hover(`{% render 'item-card' tit█le: 'value' %}`, null);
    });

    it('should return null if parameter not found in doc definition', async () => {
      await expect(provider).to.hover(`{% render 'item-card' unknown-para█m: 'value' %}`, null);
    });

    it('should return parameter info from doc definition', async () => {
      await expect(provider).to.hover(
        `{% render 'item-card' ti█tle: 'My Product' %}`,
        '### `title`: string\n\nThe title of the item',
      );
    });
  });
});

const createProvider = (getPartialDefinition: GetDocDefinitionForURI) => {
  return new HoverProvider(
    new DocumentManager(),
    publishedDocset,
    new TranslationProvider(new MockFileSystem({})),
    async () => ({}),
    getPartialDefinition,
  );
};
