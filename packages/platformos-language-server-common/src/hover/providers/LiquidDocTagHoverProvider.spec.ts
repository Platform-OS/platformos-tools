import { describe, beforeEach, it, expect } from 'vitest';
import { LiquidDocVocabulary } from '@platformos/platformos-check-common';
import { NO_LIQUID_DOC, publishedLiquidDoc } from '@platformos/platformos-check-common/src/test';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import '../../../../platformos-check-common/src/test/test-setup';
import { formatLiquidDocTagHandle } from '../../utils/liquidDoc';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

/** The prose and example are the DOCSET's; what this asserts is that the hover shows what it published. */
const published = (name: string) => {
  const annotation = publishedLiquidDoc.annotations.find((entry) => entry.name === name)!;

  return formatLiquidDocTagHandle(annotation.name, annotation.description, annotation.example);
};

describe('Module: LiquidDocTagHoverProvider', async () => {
  let provider: HoverProvider;

  const providerWith = (vocabulary: LiquidDocVocabulary) =>
    new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
        liquidDoc: async () => vocabulary,
      },
      new TranslationProvider(new MockFileSystem({})),
    );

  beforeEach(() => {
    provider = providerWith(publishedLiquidDoc);
  });

  it('should show the param help doc when hovering over the tag itself', async () => {
    await expect(provider).to.hover(
      `{% doc %} @para█m {string} name - your name {% enddoc %}`,
      published('param'),
    );
    await expect(provider).to.hover(
      `{% doc %} @exampl█e my example {% enddoc %}`,
      published('example'),
    );
    await expect(provider).to.hover(
      `{% doc %} @descrip█tion cool text is cool {% enddoc %}`,
      published('description'),
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

  /**
   * A docset published before `liquid_doc.json` describes nothing, and the hover is absent rather than
   * invented. PAIRED with the assertion above on the same source, so this cannot pass because the
   * cursor was in the wrong place.
   */
  it('shows no hover when the docset publishes no annotations', async () => {
    await expect(providerWith(NO_LIQUID_DOC)).to.hover(
      `{% doc %} @para█m {string} name - your name {% enddoc %}`,
      null,
    );
  });
});
