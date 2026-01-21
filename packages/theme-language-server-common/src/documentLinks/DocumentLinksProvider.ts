import { LiquidHtmlNode, LiquidString, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import { SourceCodeType } from '@platformos/theme-check-common';
import { DocumentLink, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI, Utils } from 'vscode-uri';

import { visit, Visitor } from '@platformos/theme-check-common';
import { DocumentManager } from '../documents';
import { FindThemeRootURI } from '../internal-types';
import { DocumentsLocator, TranslationProvider } from '@platformos/platformos-common';

export class DocumentLinksProvider {
  constructor(
    private documentManager: DocumentManager,
    private findThemeRootURI: FindThemeRootURI,
    private documentsLocator: DocumentsLocator,
    private translationProvider: TranslationProvider,
  ) {}

  async documentLinks(uriString: string): Promise<DocumentLink[]> {
    const sourceCode = this.documentManager.get(uriString);
    if (
      !sourceCode ||
      sourceCode.type !== SourceCodeType.LiquidHtml ||
      sourceCode.ast instanceof Error
    ) {
      return [];
    }

    const rootUri = await this.findThemeRootURI(uriString);
    if (!rootUri) {
      return [];
    }

    const visitor = documentLinksVisitor(
      sourceCode.textDocument,
      URI.parse(rootUri),
      this.documentsLocator,
      this.translationProvider,
    );
    return visit(sourceCode.ast, visitor);
  }
}

function documentLinksVisitor(
  textDocument: TextDocument,
  root: URI,
  documentsLocator: DocumentsLocator,
  translationProvider: TranslationProvider,
): Visitor<SourceCodeType.LiquidHtml, DocumentLink> {
  return {
    async LiquidTag(node) {
      if (
        (node.name === 'render' || node.name === 'include') &&
        typeof node.markup !== 'string' &&
        isLiquidString(node.markup.snippet)
      ) {
        const snippet = node.markup.snippet;
        return DocumentLink.create(
          range(textDocument, snippet),
          await documentsLocator.locate(root, node.name, snippet.value),
        );
      }

      if (
        node.name === 'function' &&
        typeof node.markup !== 'string' &&
        isLiquidString(node.markup.partial)
      ) {
        const snippet = node.markup.partial;
        return DocumentLink.create(
          range(textDocument, snippet),
          await documentsLocator.locate(root, node.name, snippet.value),
        );
      }

      if (
        node.name === 'graphql' &&
        typeof node.markup !== 'string' &&
        'graphql' in node.markup &&
        isLiquidString(node.markup.graphql)
      ) {
        const snippet = node.markup.graphql;
        return DocumentLink.create(
          range(textDocument, snippet),
          await documentsLocator.locate(root, node.name, snippet.value),
        );
      }
    },
    async LiquidVariable(node) {
      if (!isLiquidString(node.expression)) {
        return;
      }

      if (node.filters.some(({ name }) => ['t', 'translate'].includes(name))) {
        const [filePath] = await translationProvider.findTranslationFile(
          root,
          node.expression.value,
          'en',
        );
        return DocumentLink.create(range(textDocument, node), filePath);
      }

      if (node.filters.length > 0 && node.filters[0].name === 'asset_url') {
        const expression = node.expression;
        return DocumentLink.create(
          range(textDocument, node.expression),
          await documentsLocator.locate(root, 'asset', expression.value),
        );
      }
    },
  };
}

function range(textDocument: TextDocument, node: { position: LiquidHtmlNode['position'] }): Range {
  const start = textDocument.positionAt(node.position.start + 1);
  const end = textDocument.positionAt(node.position.end - 1);
  return Range.create(start, end);
}

function isLiquidString(node: LiquidHtmlNode): node is LiquidString {
  return node.type === NodeTypes.String;
}
