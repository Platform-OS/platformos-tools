import { describe, beforeEach, it, expect } from 'vitest';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';

const mockDocset = {
  graphQL: async () => null,
  filters: async () => [],
  objects: async () => [],
  liquidDrops: async () => [],
  tags: async () => [],
};

describe('Module: FrontmatterKeyCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: mockDocset,
    });
  });

  it('completes a key from a prefix inside page frontmatter', async () => {
    // "slu" prefix matches only "slug" in the Page schema
    await expect(provider).to.complete(
      {
        source: `---\nslu█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['slug'],
    );
  });

  it('completes a key from a prefix inside form_configurations frontmatter', async () => {
    // "nam" prefix matches only "name" in the FormConfiguration schema
    await expect(provider).to.complete(
      {
        source: `---\nnam█\n---\n`,
        relativePath: 'app/form_configurations/test.liquid',
      },
      ['name'],
    );
  });

  it('does not complete in value position for fields without enum values', async () => {
    // "slug" has no enumValues — value position should return nothing
    await expect(provider).to.complete(
      {
        source: `---\nslug: █\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      [],
    );
  });

  it('completes enum values for the method field', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nmethod: █\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      expect.arrayContaining([{ label: 'get', kind: 12 }, { label: 'post', kind: 12 }]),
    );
  });

  it('filters enum completions by prefix', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nmethod: po█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['post'],
    );
  });

  it('completes layout names when getLayoutNamesForURI is provided', async () => {
    const providerWithLayouts = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: mockDocset,
      getLayoutNamesForURI: async () => ['application', 'auth', 'modules/community/base'],
    });
    await expect(providerWithLayouts).to.complete(
      {
        source: `---\nlayout: app█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['application'],
    );
  });

  it('includes app/modules overwrite layouts alongside module layouts in completions', async () => {
    // When both app/modules/community/public/views/layouts/base.liquid (overwrite) and
    // the original modules/community/public/views/layouts/base.liquid are present,
    // both appear as 'modules/community/base' and Set deduplication yields a single entry.
    const providerWithLayouts = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: mockDocset,
      getLayoutNamesForURI: async () => ['modules/community/base'],
    });
    await expect(providerWithLayouts).to.complete(
      {
        source: `---\nlayout: modules/█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['modules/community/base'],
    );
  });

  it('filters module layout names by modules/ prefix', async () => {
    const providerWithLayouts = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: mockDocset,
      getLayoutNamesForURI: async () => ['application', 'auth', 'modules/community/base'],
    });
    await expect(providerWithLayouts).to.complete(
      {
        source: `---\nlayout: modules/█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['modules/community/base'],
    );
  });

  it('returns no layout completions when getLayoutNamesForURI is not configured', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nlayout: █\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      [],
    );
  });

  it('completes auth policy list items when getAuthPolicyNamesForURI is provided', async () => {
    const providerWithPolicies = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: mockDocset,
      getAuthPolicyNamesForURI: async () => ['is_authenticated', 'is_admin'],
    });
    await expect(providerWithPolicies).to.complete(
      {
        source: `---\nauthorization_policies:\n  - is_a█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      expect.arrayContaining([{ label: 'is_admin', kind: 12 }]),
    );
  });

  it('does not complete outside the frontmatter', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nslug: /home\n---\n{{ █ }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      [],
    );
  });

  it('does not complete for files with no known schema', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nslu█\n---\n{{ content }}`,
        relativePath: 'some/random/path/file.liquid',
      },
      [],
    );
  });

  it('excludes already-used keys from completions', async () => {
    // slug is already present — "slu" prefix should return nothing
    await expect(provider).to.complete(
      {
        source: `---\nslug: /home\nslu█\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      [],
    );
  });
});
