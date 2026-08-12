import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { CompletionsProvider } from '../CompletionsProvider';
import { publishedDocset } from '@platformos/platformos-check-common/src/test';

describe('Module: HtmlAttributeValueCompletionProvider', async () => {
  let provider: CompletionsProvider;

  beforeEach(async () => {
    provider = new CompletionsProvider({
      documentManager: new DocumentManager(),
      platformosDocset: publishedDocset,
    });
  });

  it('should complete known void element attribute values', async () => {
    const expected = ['lazy', 'eager'].sort();
    await expect(provider).to.complete('<img loading="█"', expected);
  });

  it('should complete known tag attribute values', async () => {
    const expected = ['get', 'post', 'dialog'].sort();
    await expect(provider).to.complete('<form method="█"', expected);
  });

  it('should filter results', async () => {
    const expected = ['get'].sort();
    await expect(provider).to.complete('<form method="g█"', expected);
  });
});
