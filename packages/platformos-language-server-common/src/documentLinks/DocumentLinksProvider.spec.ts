import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentManager } from '../documents';
import { DocumentLinksProvider } from './DocumentLinksProvider';
import { DocumentsLocator, TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { SearchPathsLoader } from '../utils/searchPaths';

function makeProvider(
  documentManager: DocumentManager,
  rootUri: string,
  mockFs: MockFileSystem,
): DocumentLinksProvider {
  return new DocumentLinksProvider(
    documentManager,
    async () => rootUri,
    new DocumentsLocator(mockFs),
    new TranslationProvider(mockFs),
    new SearchPathsLoader(mockFs),
  );
}

describe('DocumentLinksProvider', () => {
  let documentManager: DocumentManager;
  let documentLinksProvider: DocumentLinksProvider;
  let rootUri: string;
  let uriString: string;

  beforeEach(() => {
    documentManager = new DocumentManager();
    const fs = new MockFileSystem({
      'path/to/project/app/lib/commands/apply.liquid': 'apply content',
      'path/to/project/app/views/apply_view.liquid': 'apply view content',
    });
    documentLinksProvider = makeProvider(documentManager, 'file:///path/to/project', fs);
  });

  it('should return an empty array for non-LiquidHtml documents', async () => {
    uriString = 'file:///path/to/non-liquid-html-document.txt';
    rootUri = 'file:///path/to/project';

    documentManager.open(uriString, 'Sample plain text content', 1);

    const result = await documentLinksProvider.documentLinks(uriString);
    expect(result).toEqual([]);
  });

  it('should return an empty array for non-existent documents', async () => {
    uriString = 'file:///path/to/non-existent-document.txt';
    rootUri = 'file:///path/to/project';

    const result = await documentLinksProvider.documentLinks(uriString);
    expect(result).toEqual([]);
  });

  it('should return a list of document links with correct URLs for a LiquidHtml document', async () => {
    uriString = 'file:///app/views/partials/liquid-html-document.liquid';
    rootUri = 'file:///path/to/project';

    const liquidHtmlContent = `
      {% function a = 'commands/apply' %}
    `;

    documentManager.open(uriString, liquidHtmlContent, 1);

    const result = await documentLinksProvider.documentLinks(uriString);
    const expectedUrls = ['file:///path/to/project/app/lib/commands/apply.liquid'];

    expect(result.length).toBe(expectedUrls.length);
    for (let i = 0; i < expectedUrls.length; i++) {
      expect(result[i].target).toBe(expectedUrls[i]);
    }
  });

  describe('theme_render_rc', () => {
    it('should resolve theme_render_rc partials via theme_search_paths', async () => {
      rootUri = 'file:///project';
      uriString = 'file:///project/app/views/pages/index.liquid';

      const mockFs = new MockFileSystem({
        'project/app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
        'project/app/views/partials/theme/dress/card.liquid': 'dress card',
        'project/app/views/partials/theme/simple/footer.liquid': 'simple footer',
      });

      const provider = makeProvider(documentManager, rootUri, mockFs);

      documentManager.open(
        uriString,
        "{% theme_render_rc 'card' %} {% theme_render_rc 'footer' %}",
        1,
      );

      const result = await provider.documentLinks(uriString);

      expect(result).toHaveLength(2);
      expect(result[0].target).toBe('file:///project/app/views/partials/theme/dress/card.liquid');
      expect(result[1].target).toBe(
        'file:///project/app/views/partials/theme/simple/footer.liquid',
      );
    });

    it('should fallback to standard resolution when no config exists', async () => {
      rootUri = 'file:///project';
      uriString = 'file:///project/app/views/pages/index.liquid';

      const mockFs = new MockFileSystem({
        'project/app/views/partials/card.liquid': 'default card',
      });

      const provider = makeProvider(documentManager, rootUri, mockFs);

      documentManager.open(uriString, "{% theme_render_rc 'card' %}", 1);

      const result = await provider.documentLinks(uriString);

      expect(result).toHaveLength(1);
      expect(result[0].target).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should resolve theme_render_rc with Liquid wildcard paths', async () => {
      rootUri = 'file:///project';
      uriString = 'file:///project/app/views/pages/index.liquid';

      const mockFs = new MockFileSystem({
        'project/app/config.yml': 'theme_search_paths:\n  - theme/{{ context.constants.THEME }}',
        'project/app/views/partials/theme/custom/hero.liquid': 'custom hero',
      });

      const provider = makeProvider(documentManager, rootUri, mockFs);

      documentManager.open(uriString, "{% theme_render_rc 'hero' %}", 1);

      const result = await provider.documentLinks(uriString);

      expect(result).toHaveLength(1);
      expect(result[0].target).toBe('file:///project/app/views/partials/theme/custom/hero.liquid');
    });

    it('should not use search paths for regular render tags', async () => {
      rootUri = 'file:///project';
      uriString = 'file:///project/app/views/pages/index.liquid';

      const mockFs = new MockFileSystem({
        'project/app/config.yml': 'theme_search_paths:\n  - theme/dress',
        'project/app/views/partials/card.liquid': 'default card',
      });

      const provider = makeProvider(documentManager, rootUri, mockFs);

      documentManager.open(uriString, "{% render 'card' %}", 1);

      const result = await provider.documentLinks(uriString);

      expect(result).toHaveLength(1);
      expect(result[0].target).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should pick up new config after cache invalidation', async () => {
      rootUri = 'file:///project';
      uriString = 'file:///project/app/views/pages/index.liquid';

      const initialFiles: Record<string, string> = {
        'project/app/views/partials/card.liquid': 'default card',
        'project/app/views/partials/theme/new/card.liquid': 'new card',
      };
      const mockFs = new MockFileSystem(initialFiles);
      const provider = makeProvider(documentManager, rootUri, mockFs);

      documentManager.open(uriString, "{% theme_render_rc 'card' %}", 1);

      const result1 = await provider.documentLinks(uriString);
      expect(result1).toHaveLength(1);
      expect(result1[0].target).toBe('file:///project/app/views/partials/card.liquid');

      // Simulate config.yml being created with search paths — new provider with new fs
      const updatedFs = new MockFileSystem({
        ...initialFiles,
        'project/app/config.yml': 'theme_search_paths:\n  - theme/new',
      });
      const provider2 = makeProvider(documentManager, rootUri, updatedFs);

      const result2 = await provider2.documentLinks(uriString);
      expect(result2).toHaveLength(1);
      expect(result2[0].target).toBe('file:///project/app/views/partials/theme/new/card.liquid');
    });
  });
  /**
   * One malformed translation file must not cost the file every link it has.
   *
   * `{{ '…' | t }}` resolves through `TranslationProvider.findTranslationFile`,
   * which parses the project's translation YAML. `yaml.load` THROWS on a
   * duplicated mapping key — two people adding the same key, which a real
   * project produces — and because the whole visit is one promise, that
   * rejection took out `textDocument/documentLink` for the entire file: the
   * `render` link beside it disappeared too, even though it had already
   * resolved. Hover and go-to-definition are separate requests and kept
   * working, so it read as "links stopped being created" rather than as an
   * error, which is what made it hard to place.
   */
  describe('when a translation file does not parse', () => {
    it('still returns the links that do resolve', async () => {
      const projectRoot = 'file:///path/to/project';
      const fs = new MockFileSystem(
        {
          'path/to/project/app/views/partials/card.liquid': 'a partial',
          // `greeting.hello` twice under the same parent: a duplicated mapping key.
          'path/to/project/app/translations/en/greetings.yml':
            'en:\n  greeting:\n    hello: Hello\n    hello: Hi again\n',
        },
        'file:///',
      );
      const provider = makeProvider(documentManager, projectRoot, fs);
      const uri = 'file:///path/to/project/app/views/pages/index.liquid';
      documentManager.open(uri, `{% render 'card' %}{{ 'greeting.hello' | t }}`, 1);

      const links = await provider.documentLinks(uri);

      expect(links.map((link) => link.target)).toEqual([
        'file:///path/to/project/app/views/partials/card.liquid',
        undefined,
      ]);
    });
  });
});
