import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';
import { DocDefinition } from '@platformos/platformos-check-common';

const uri = 'file:///app/views/partials/product-card.liquid';

describe('Module: RenderPartialParameterCompletionProvider', async () => {
  let provider: CompletionsProvider;
  const mockPartialName = 'product-card';
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
        {
          name: 'border-radius',
          description: 'The border radius in px',
          type: 'number',
          required: false,
          nodeType: 'param',
        },
        {
          name: 'no-type',
          description: 'This parameter has no type',
          type: null,
          required: true,
          nodeType: 'param',
        },
        {
          name: 'no-description',
          description: null,
          type: 'string',
          required: true,
          nodeType: 'param',
        },
        {
          name: 'no-type-or-description',
          description: null,
          type: null,
          required: true,
          nodeType: 'param',
        },
      ],
    },
  };

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      getDocDefinitionForURI: async (_uri, partialName) => {
        if (mockPartialName === partialName) {
          return mockPartialDefinition;
        }
      },
    });
  });

  it("provide completion options that doesn't already exist in render tag", async () => {
    await expect(provider).to.complete(`{% render '${mockPartialName}', █ %}`, [
      'title',
      'border-radius',
      'no-type',
      'no-description',
      'no-type-or-description',
    ]);
    await expect(provider).to.complete(
      `{% render '${mockPartialName}', title: 'foo', border-radius: 5, █ %}`,
      ['no-type', 'no-description', 'no-type-or-description'],
    );
  });

  it('does not provide completion options if the partial does not exist', async () => {
    await expect(provider).to.complete(`{% render 'fake-partial', █ %}`, []);
  });
});
