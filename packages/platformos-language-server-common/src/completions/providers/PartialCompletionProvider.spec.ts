import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { CompletionsProvider } from '../CompletionsProvider';
import { MetafieldDefinitionMap } from '@platformos/platformos-check-common';

describe('Module: RenderSnippetCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      themeDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      getTranslationsForURI: async (_) => ({}),
      getPartialNamesForURI: async (_) => ['product-card', 'image'],
      getMetafieldDefinitions: async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    });
  });

  it('should complete snippets correctly', async () => {
    await expect(provider).to.complete('{% render "', ['product-card', 'image']);
  });
});

describe('Module: PartialCompletionProvider with paths', async () => {
  it('should complete module paths - /modules/user/commands/test', async () => {
    const provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      themeDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      getTranslationsForURI: async (_) => ({}),
      getPartialNamesForURI: async (_uri, partial, _tag) => {
        if (partial === '/modules/user/commands') {
          return ['test'];
        }
        return [];
      },
      getMetafieldDefinitions: async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    });

    await expect(provider).to.complete('{% render "/modules/user/commands', ['test']);
  });

  it('should complete root commands path - /commands/test2', async () => {
    const provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      themeDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      getTranslationsForURI: async (_) => ({}),
      getPartialNamesForURI: async (_uri, partial, _tag) => {
        if (partial === '/commands') {
          return ['test2'];
        }
        return [];
      },
      getMetafieldDefinitions: async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    });

    await expect(provider).to.complete('{% render "/commands', ['test2']);
  });

  it('should complete multiple files in directory', async () => {
    const provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      themeDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      getTranslationsForURI: async (_) => ({}),
      getPartialNamesForURI: async (_uri, partial, _tag) => {
        if (partial === '/modules/user/commands') {
          return ['create', 'update', 'delete'];
        }
        return [];
      },
      getMetafieldDefinitions: async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    });

    await expect(provider).to.complete('{% render "/modules/user/commands', [
      'create',
      'update',
      'delete',
    ]);
  });
});
