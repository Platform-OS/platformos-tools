import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';

describe('Module: LiquidDocTagCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
    });
  });

  it('offers completions within liquid doc tag for partials', async () => {
    await expect(provider).to.complete(
      { source: `{% doc %} @█`, relativePath: 'file://app/views/partials/file.liquid' },
      ['param', 'example', 'description'],
    );
    await expect(provider).to.complete(
      { source: `{% doc %} @par█`, relativePath: 'file://app/views/partials/file.liquid' },
      ['param'],
    );
  });

  it("does not offer completion if it doesn't start with @", async () => {
    await expect(provider).to.complete(
      { source: `{% doc %} █`, relativePath: 'file://app/views/partials/file.liquid' },
      [],
    );
  });

  it('does not offer completion if it is not within a doc tag', async () => {
    await expect(provider).to.complete(
      { source: `{% notdoc %} @█`, relativePath: 'file://app/views/partials/file.liquid' },
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
          relativePath: 'file://app/views/partials/file.liquid',
        },
        ['param', 'example', 'description'],
      );
    });

    it('offers completions when @ is at the start of a new line following a node that accepts free-form text', async () => {
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @prompt Text
          @█`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        ['param', 'example', 'description'],
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @description Text
          @█`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        ['param', 'example', 'description'],
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @example Text
          @█`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        ['param', 'example', 'description'],
      );
    });

    it('does not offer completions when @ is not at the start of a line', async () => {
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @prompt This is a promptwith @█`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        [],
      );
      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @description This is a description with @█`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        [],
      );

      await expect(provider).to.complete(
        {
          source: `{% doc %}
          @example Here is an example with @`,
          relativePath: 'file://app/views/partials/file.liquid',
        },
        [],
      );
    });
  });
});
