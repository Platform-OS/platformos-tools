import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';
import { LiquidDocVocabulary } from '@platformos/platformos-check-common';
import { NO_LIQUID_DOC, publishedLiquidDoc } from '@platformos/platformos-check-common/src/test';

describe('Module: LiquidDocParamTypeCompletionProvider', async () => {
  let provider: CompletionsProvider;

  const providerWith = (vocabulary: LiquidDocVocabulary) =>
    new CompletionsProvider({
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: new DocumentManager(
        undefined,
        undefined,
        undefined,
        undefined,
        async () => '/path/to',
      ),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [
          {
            name: 'current_user',
          },
        ],
        liquidDoc: async () => vocabulary,
        tags: async () => [],
      },
    });

  beforeEach(async () => {
    provider = providerWith(publishedLiquidDoc);
  });

  /**
   * A docset published before `liquid_doc.json` offers no types at all — not the object names on their
   * own, which would read as "`string` is not a param type". PAIRED with the control, so the emptiness
   * is the unpublished vocabulary rather than a source this provider never completes in.
   */
  it('offers nothing when the docset publishes no param types', async () => {
    const source = `{% doc %} @param {█`;
    const relativePath = 'app/views/partials/file.liquid';

    await expect(providerWith(NO_LIQUID_DOC)).to.complete({ source, relativePath }, []);

    await expect(providerWith(publishedLiquidDoc)).to.complete({ source, relativePath }, [
      ...publishedLiquidDoc.param_types.map(({ name }) => name),
      'current_user',
    ]);
  });

  it("offers type completions within liquid doc's param type tag for partials", async () => {
    const sources = [`{% doc %} @param {█`, `{% doc %} @param  {  █`];

    for (const source of sources) {
      await expect(provider).to.complete(
        { source, relativePath: 'app/views/partials/file.liquid' },
        // DERIVED: the published types plus the one object the mock docset knows.
        [...publishedLiquidDoc.param_types.map(({ name }) => name), 'current_user'],
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
        { source, relativePath: 'app/views/partials/file.liquid' },
        [],
      );
    }
  });
});
