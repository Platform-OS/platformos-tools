import { LiquidHtmlNode, LiquidString, NodeTypes } from '@platformos/liquid-html-parser';
import { SourceCodeType } from '@platformos/platformos-check-common';
import { DocumentLink, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { visit, Visitor } from '@platformos/platformos-check-common';
import { DocumentManager } from '../documents';
import { FindAppRootURI } from '../internal-types';
import { DocumentsLocator, DocumentType, TranslationProvider } from '@platformos/platformos-common';
import { SearchPathsLoader } from '../utils/searchPaths';

export class DocumentLinksProvider {
  constructor(
    private documentManager: DocumentManager,
    private findAppRootURI: FindAppRootURI,
    private documentsLocator: DocumentsLocator,
    private translationProvider: TranslationProvider,
    private searchPathsCache: SearchPathsLoader,
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

    const rootUri = await this.findAppRootURI(uriString);
    if (!rootUri) {
      return [];
    }

    const root = URI.parse(rootUri);
    const searchPaths = await this.searchPathsCache.get(root);

    const visitor = documentLinksVisitor(
      sourceCode.textDocument,
      root,
      this.documentsLocator,
      this.translationProvider,
      searchPaths,
    );
    return visit(sourceCode.ast, visitor);
  }
}

function documentLinksVisitor(
  textDocument: TextDocument,
  root: URI,
  documentsLocator: DocumentsLocator,
  translationProvider: TranslationProvider,
  searchPaths: string[] | null,
): Visitor<SourceCodeType.LiquidHtml, DocumentLink> {
  return {
    async LiquidTag(node) {
      const markup = node.markup;
      if (typeof markup === 'string' || markup === null) return;

      const name = node.name as DocumentType;

      // render, include, function, theme_render_rc all have a .partial field
      if ('partial' in markup && isLiquidString(markup.partial)) {
        return DocumentLink.create(
          range(textDocument, markup.partial),
          await documentsLocator.locate(root, name, markup.partial.value, searchPaths),
        );
      }

      // graphql has a .graphql field
      if ('graphql' in markup && isLiquidString(markup.graphql)) {
        return DocumentLink.create(
          range(textDocument, markup.graphql),
          await documentsLocator.locate(root, name, markup.graphql.value),
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
