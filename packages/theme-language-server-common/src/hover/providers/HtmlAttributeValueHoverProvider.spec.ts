import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { MetafieldDefinitionMap } from '@platformos/theme-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/theme-check-common/src/test';

describe('Module: HtmlAttributeHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        systemTranslations: async () => ({}),
      },
      new TranslationProvider(new MockFileSystem({}, '.')),
      async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    );
  });

  it('should return the hover description of the attribute', async () => {
    await expect(provider).to.hover(`<img loading="lazy█">`, expect.stringMatching(/##* lazy/));
    await expect(provider).to.hover(`<img loading='lazy█'>`, expect.stringMatching(/##* lazy/));
    await expect(provider).to.hover(`<img loading=lazy█>`, expect.stringMatching(/##* lazy/));
  });

  it('should return nothing if the thing is unknown', async () => {
    await expect(provider).to.hover(`<img loading="unknown█">`, null);
    await expect(provider).to.hover(`<img loading='unknown█'>`, null);
    await expect(provider).to.hover(`<img loading=unknown█>`, null);
  });
});
