import { describe, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';

import { GetDocDefinitionForURI, DocDefinition } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

const uri = 'file:///app/views/partials/product-card.liquid';

describe('Module: RenderPartialHoverProvider', async () => {
  let provider: HoverProvider;
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
      description: {
        content: 'This is a description',
        nodeType: 'description',
      },
      examples: [
        {
          content: '{{ product }}',
          nodeType: 'example',
        },
      ],
    },
  };

  describe('hover', () => {
    it('should return partial definition with all parameters', async () => {
      provider = createProvider(async () => mockPartialDefinition);
      // prettier-ignore
      const expectedHoverContent =
`### product-card

**Description:**


This is a description

**Parameters:**
- \`title\`: string - The title of the product

**Examples:**
\`\`\`liquid
{{ product }}
\`\`\``;

      await expect(provider).to.hover(`{% render 'product-car█d' %}`, expectedHoverContent);
    });

    it('should return nothing if not in render tag', async () => {
      await expect(provider).to.hover(`{% assign asdf = 'any-str█ing' %}`, null);
      await expect(provider).to.hover(`{{ 'any-str█ing' }}`, null);
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
