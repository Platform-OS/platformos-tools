import { expect, describe, it, beforeEach } from 'vitest';
import { CompletionsProvider } from '../completions';
import { DocumentManager } from '../documents';

describe('Module: CompletionItemsAssertion', () => {
  let provider: CompletionsProvider;
  let documentManager: DocumentManager;

  beforeEach(async () => {
    documentManager = new DocumentManager();
    provider = new CompletionsProvider({
      documentManager,
      platformosDocset: {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [{ name: 'render' }],
      },
    });
  });

  it('should assert a list of labels', async () => {
    await expect(provider).to.complete('{% rend', ['render']);
  });

  it('should assert a list of completion items', async () => {
    await expect(provider).to.complete('{% rend', [
      expect.objectContaining({
        label: 'render',
        sortText: 'render',
        documentation: {
          kind: 'markdown',
          value: '### render',
        },
        insertTextFormat: 2,
        kind: 14,
      }),
    ]);
  });

  it('should assert an empty list', async () => {
    await expect(provider).to.complete('{% something', []);
  });
});
