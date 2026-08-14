import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';

import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem, publishedDocset } from '@platformos/platformos-check-common/src/test';

describe('Module: HtmlAttributeHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    provider = new HoverProvider(
      new DocumentManager(),
      publishedDocset,
      new TranslationProvider(new MockFileSystem({}, '.')),
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
