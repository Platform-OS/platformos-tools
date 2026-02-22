import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';
import { BasicParamTypes } from '@platformos/platformos-check-common';

describe('Module: LiquidDocParamTypeCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [
          {
            name: 'product',
          },
        ],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
    });
  });

  it("offers type completions within liquid doc's param type tag for partials", async () => {
    const sources = [`{% doc %} @param {█`, `{% doc %} @param  {  █`];

    for (const source of sources) {
      await expect(provider).to.complete(
        { source, relativePath: 'file://app/views/partials/file.liquid' },
        [...Object.values(BasicParamTypes), 'product'],
      );
    }
  });

  it("does not offer completion if it's not within liquid doc's param type tag", async () => {
    const sources = [
      `{% doc %} @param {}█`,
      `{% doc %} @example {}█`,
      `{% doc %} @param {string} - █`,
      `@param {█`,
    ];

    for (const source of sources) {
      await expect(provider).to.complete(
        { source, relativePath: 'file://app/views/partials/file.liquid' },
        [],
      );
    }
  });

});
