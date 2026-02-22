import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import '../../../../platformos-check-common/src/test/test-setup';
import { formatLiquidDocTagHandle, SUPPORTED_LIQUID_DOC_TAG_HANDLES } from '../../utils/liquidDoc';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('Module: RenderSnippetParameterHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(() => {
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
      new TranslationProvider(new MockFileSystem({})),
    );
  });

  it('should show the param help doc when hovering over the tag itself', async () => {
    await expect(provider).to.hover(
      `{% doc %} @para█m {string} name - your name {% enddoc %}`,
      formatLiquidDocTagHandle(
        'param',
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['param'].description,
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['param'].example,
      ),
    );
    await expect(provider).to.hover(
      `{% doc %} @exampl█e my example {% enddoc %}`,
      formatLiquidDocTagHandle(
        'example',
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['example'].description,
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['example'].example,
      ),
    );
    await expect(provider).to.hover(
      `{% doc %} @descrip█tion cool text is cool {% enddoc %}`,
      formatLiquidDocTagHandle(
        'description',
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['description'].description,
        SUPPORTED_LIQUID_DOC_TAG_HANDLES['description'].example,
      ),
    );
  });

  it('should not show the param help doc when hovering over text outside param name', async () => {
    await expect(provider).to.hover(
      `{% doc %} @param {string} name - █your name {% enddoc %}`,
      null,
    );
    await expect(provider).to.hover(`{% doc %} @example my █example {% enddoc %}`, null);
    await expect(provider).to.hover(`{% doc %} @description cool text█ is cool {% enddoc %}`, null);
  });
});
