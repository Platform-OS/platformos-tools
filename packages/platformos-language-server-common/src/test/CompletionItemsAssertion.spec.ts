import { expect, describe, it, beforeEach } from 'vitest';
import { publishedDocset } from '@platformos/platformos-check-common/src/test';
import { CompletionsProvider } from '../completions';
import { DocumentManager } from '../documents';

describe('Module: CompletionItemsAssertion', () => {
  let provider: CompletionsProvider;
  let documentManager: DocumentManager;

  beforeEach(async () => {
    documentManager = new DocumentManager();
    provider = new CompletionsProvider({
      documentManager,
      platformosDocset: publishedDocset,
    });
  });

  // `unl` matches one published tag, so the exact-list form of the matcher has something to be exact
  // about without this file deciding which tags exist.
  it('should assert a list of labels', async () => {
    await expect(provider).to.complete('{% unl', ['unless']);
  });

  it('should assert a list of completion items', async () => {
    await expect(provider).to.complete('{% unl', [
      expect.objectContaining({
        label: 'unless',
        sortText: 'unless',
        insertTextFormat: 2,
        kind: 14,
      }),
    ]);
  });

  it('should assert an empty list', async () => {
    await expect(provider).to.complete('{% something', []);
  });
});
