import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { MetafieldDefinitionMap } from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('Module: LiquidTagHoverProvider', async () => {
  let provider: HoverProvider;

  beforeEach(async () => {
    provider = new HoverProvider(
      new DocumentManager(),
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [
          { name: 'if', description: 'if statement description' },
          { name: 'echo', description: 'echo description' },
        ],
        systemTranslations: async () => ({}),
      },
      new TranslationProvider(new MockFileSystem({})),
      async (_rootUri: string) => ({} as MetafieldDefinitionMap),
    );
  });

  it('should return the hover description of the correct tag', async () => {
    // cursor always points at character before █
    await expect(provider).to.hover(`{%█ if cond %}{% endif %}`, expect.stringContaining('if'));
    await expect(provider).to.hover(`{% i█f cond %}{% endif %}`, expect.stringContaining('if'));
    await expect(provider).to.hover(`{% if█ cond %}{% endif %}`, expect.stringContaining('if'));
    await expect(provider).to.hover(`{% if cond █%}{% endif %}`, expect.stringContaining('if'));
    await expect(provider).to.hover(`{% if cond %}{% █ endif %}`, expect.stringContaining('if'));
    await expect(provider).to.hover(`{% echo█ 'hi' %}`, expect.stringContaining('echo'));
  });

  it('should not return the tag hover description when hovering over anything else in the tag', async () => {
    await expect(provider).to.not.hover(`{% if c█ond %}{% endif %}`, expect.stringContaining('if'));
    await expect(provider).to.not.hover(
      `{% if cond %} █ {%  endif %}`,
      expect.stringContaining('if'),
    );
  });

  it('should return nothing if there are no docs for that tag', async () => {
    await expect(provider).to.hover(`{% unknown█ %}`, null);
  });
});
