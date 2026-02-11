import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentManager } from '../documents';
import { DocumentLinksProvider } from './DocumentLinksProvider';
import { DocumentsLocator, TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';

describe('DocumentLinksProvider', () => {
  let documentManager: DocumentManager;
  let documentLinksProvider: DocumentLinksProvider;
  let documentsLocator: DocumentsLocator;
  let fs: MockFileSystem;
  let rootUri: string;
  let uriString: string;

  beforeEach(() => {
    documentManager = new DocumentManager();
    fs = new MockFileSystem({
      'path/to/project/app/lib/commands/apply.liquid': 'apply content',
      'path/to/project/app/views/apply_view.liquid': 'apply view content',
    });
    documentsLocator = new DocumentsLocator(fs);
    documentLinksProvider = new DocumentLinksProvider(
      documentManager,
      async () => rootUri,
      documentsLocator,
      new TranslationProvider(fs),
    );
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
    uriString = 'file:///path/to/liquid-html-document.liquid';
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
});
