import { describe, beforeEach, it, expect } from 'vitest';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { CompletionsProvider } from '../CompletionsProvider';
import { DocumentManager } from '../../documents';

const mockDocset = {
  graphQL: async () => null,
  filters: async () => [],
  objects: async () => [],
  liquidDrops: async () => [],
  tags: async () => [],
};

/**
 * A manager wired the way startServer wires it: it carries the root finder, so
 * `DocumentManager.fileType` — THE classifier every provider uses — can answer
 * for buffers under the fixture root before any app has been preloaded.
 */
const makeDocumentManager = (fs?: ConstructorParameters<typeof DocumentManager>[0]) =>
  new DocumentManager(fs, undefined, undefined, undefined, async () => '/path/to');

describe('Module: FrontmatterKeyCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(),
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
      expect.arrayContaining([
        { label: 'get', kind: 12 },
        { label: 'post', kind: 12 },
      ]),
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
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(),
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
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(),
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

  /**
   * The default (no `getLayoutNamesForURI` override) reads names off the root's
   * `App`, and `AppFile.name` strips the response format along with the extension.
   * The hand-rolled walk this replaced stripped only `.liquid`, so a layout at
   * `1col.html.liquid` was offered as `1col.html` — a spelling `layout:` resolves
   * to nothing — and the module branch had the same bug in its own copy.
   */
  it('offers a format-carrying layout under its resolvable name, app and module alike', async () => {
    const fs = new MockFileSystem({
      'path/to/app/views/layouts/1col.html.liquid': '{{ content }}',
      'path/to/modules/community/public/views/layouts/base.html.liquid': '{{ content }}',
    });
    const appBackedProvider = new CompletionsProvider({
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(fs),
      platformosDocset: mockDocset,
    });

    await expect(appBackedProvider).to.complete(
      {
        source: `---\nlayout: █\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['1col', 'modules/community/base'],
    );
  });

  it('offers authorization policies off the App by default, module policies included', async () => {
    const fs = new MockFileSystem({
      'path/to/app/authorization_policies/is_admin.liquid': 'true',
      'path/to/modules/community/public/authorization_policies/is_member.liquid': 'true',
    });
    const appBackedProvider = new CompletionsProvider({
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(fs),
      platformosDocset: mockDocset,
    });

    await expect(appBackedProvider).to.complete(
      {
        source: `---\nauthorization_policies:\n  - █\n---\n{{ content }}`,
        relativePath: 'app/views/pages/test.html.liquid',
      },
      ['is_admin', 'modules/community/is_member'],
    );
  });

  it('filters module layout names by modules/ prefix', async () => {
    const providerWithLayouts = new CompletionsProvider({
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(),
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

  it('returns no layout completions when the workspace has no layouts to offer', async () => {
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
      // The test helper mounts every fixture under `/path/to`; classification is
      // anchored, so the providers need that root to tell a partial from a page.
      findAppRootURI: async () => '/path/to',
      documentManager: makeDocumentManager(),
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

  it('completes enum values for the request_type field on ApiCall', async () => {
    await expect(provider).to.complete(
      {
        source: `---\nrequest_type: █\n---\n`,
        relativePath: 'app/notifications/api_call_notifications/test.liquid',
      },
      expect.arrayContaining([
        { label: 'GET', kind: 12 },
        { label: 'POST', kind: 12 },
        { label: 'DELETE', kind: 12 },
      ]),
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
