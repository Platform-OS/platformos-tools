import { describe, beforeEach, it, expect } from 'vitest';
import { LiquidDocVocabulary } from '@platformos/platformos-check-common';
import { NO_LIQUID_DOC, publishedLiquidDoc } from '@platformos/platformos-check-common/src/test';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';

/**
 * Every annotation the REAL docset publishes, DERIVED — the list is the platform's to decide, and an
 * expectation restating it would fail on a docs release instead of on a bug here.
 */
const PUBLISHED = publishedLiquidDoc.annotations.map(({ name }) => name);

describe('Module: LiquidDocTagCompletionProvider', async () => {
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
        liquidDrops: async () => [],
        liquidDoc: async () => vocabulary,
        tags: async () => [],
      },
    });

  beforeEach(async () => {
    provider = providerWith(publishedLiquidDoc);
  });

  /**
   * A docset published before `liquid_doc.json` offers nothing — PAIRED with the control below, so the
   * emptiness is caused by the unpublished vocabulary and not by a source the provider cannot handle.
   */
  it('offers nothing when the docset publishes no annotations', async () => {
    await expect(providerWith(NO_LIQUID_DOC)).to.complete(
      { source: `{% doc %} @█`, relativePath: 'app/views/partials/file.liquid' },
      [],
    );

    await expect(providerWith(publishedLiquidDoc)).to.complete(
      { source: `{% doc %} @█`, relativePath: 'app/views/partials/file.liquid' },
      PUBLISHED,
    );
  });

  it('offers completions within liquid doc tag for partials', async () => {
    await expect(provider).to.complete(
      { source: `{% doc %} @█`, relativePath: 'app/views/partials/file.liquid' },
      PUBLISHED,
    );
    await expect(provider).to.complete(
      { source: `{% doc %} @par█`, relativePath: 'app/views/partials/file.liquid' },
      PUBLISHED.filter((name) => name.startsWith('par')),
    );
  });

  it("does not offer completion if it doesn't start with @", async () => {
    await expect(provider).to.complete(
      { source: `{% doc %} █`, relativePath: 'app/views/partials/file.liquid' },
      [],
    );
  });

  it('does not offer completion if it is not within a doc tag', async () => {
    await expect(provider).to.complete(
      { source: `{% notdoc %} @█`, relativePath: 'app/views/partials/file.liquid' },
      [],
    );
  });

  describe('nodes that accept free-form text', () => {
    it('offers completions when @ is at the start of a new line following an implicit description', async () => {
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          This is an implicit description
          @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        PUBLISHED,
      );
    });

    it('offers completions when @ is at the start of a new line following a node that accepts free-form text', async () => {
      // `@prompt` is no annotation — Shopify Magic's, dropped from the grammar — so this is the
      // TEXT case: a line the parser did not recognise still leaves the next `@` completable.
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @prompt Text
          @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        PUBLISHED,
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @description Text
          @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        PUBLISHED,
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @example Text
          @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        PUBLISHED,
      );
    });

    it('does not offer completions when @ is not at the start of a line', async () => {
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @prompt This is a promptwith @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        [],
      );
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @description This is a description with @█`,
          relativePath: 'app/views/partials/file.liquid',
        },
        [],
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @example Here is an example with @`,
          relativePath: 'app/views/partials/file.liquid',
        },
        [],
      );
    });
  });
});
