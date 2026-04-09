import { findCurrentNode, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem, DocumentsLocator, RouteTable } from '@platformos/platformos-common';
import { DefinitionLink, DefinitionParams } from 'vscode-languageserver';

import { AugmentedJsonSourceCode, DocumentManager } from '../documents';
import { SearchPathsLoader } from '../utils/searchPaths';
import { BaseDefinitionProvider } from './BaseDefinitionProvider';
import { FrontmatterDefinitionProvider } from './providers/FrontmatterDefinitionProvider';
import { PageRouteDefinitionProvider } from './providers/PageRouteDefinitionProvider';
import { RenderPartialDefinitionProvider } from './providers/RenderPartialDefinitionProvider';
import { TranslationStringDefinitionProvider } from './providers/TranslationStringDefinitionProvider';

export class DefinitionProvider {
  private providers: BaseDefinitionProvider[];
  private pageRouteProvider?: PageRouteDefinitionProvider;

  constructor(
    private documentManager: DocumentManager,
    getDefaultLocaleSourceCode: (uri: string) => Promise<AugmentedJsonSourceCode | null>,
    fs?: AbstractFileSystem,
    findAppRootURI?: (uri: string) => Promise<string | null>,
    documentsLocator?: DocumentsLocator,
    searchPathsCache?: SearchPathsLoader,
  ) {
    this.providers = [
      new TranslationStringDefinitionProvider(documentManager, getDefaultLocaleSourceCode),
    ];

    if (fs && findAppRootURI) {
      this.pageRouteProvider = new PageRouteDefinitionProvider(documentManager, fs, findAppRootURI);
      this.providers.push(this.pageRouteProvider);
      this.providers.push(new FrontmatterDefinitionProvider(documentManager, fs, findAppRootURI));

      if (documentsLocator && searchPathsCache) {
        this.providers.push(
          new RenderPartialDefinitionProvider(
            documentManager,
            documentsLocator,
            searchPathsCache,
            findAppRootURI,
          ),
        );
      }
    }
  }

  /** Notify the route table that a page file was created or changed. */
  onPageFileChanged(uri: string, content: string): void {
    this.pageRouteProvider?.onPageFileChanged(uri, content);
  }

  /** Notify the route table that a page file was deleted. */
  onPageFileDeleted(uri: string): void {
    this.pageRouteProvider?.onPageFileDeleted(uri);
  }

  /**
   * Invalidate the route table so it will be fully rebuilt on next use.
   * Call after bulk filesystem changes (e.g., git checkout, branch switch).
   */
  invalidateRouteTable(): void {
    this.pageRouteProvider?.invalidate();
  }

  /**
   * Returns the shared RouteTable, or undefined if route support is not configured.
   * When undefined (no fs/findAppRootURI), the check pipeline will build a fresh
   * RouteTable per run via makeGetRouteTable in context-utils.ts.
   */
  getRouteTable(): RouteTable | undefined {
    return this.pageRouteProvider?.getRouteTable();
  }

  async definitions(params: DefinitionParams): Promise<DefinitionLink[] | null> {
    const sourceCode = this.documentManager.get(params.textDocument.uri);
    if (
      !sourceCode ||
      sourceCode.type !== SourceCodeType.LiquidHtml ||
      sourceCode.ast instanceof Error
    ) {
      return null;
    }

    const { textDocument } = sourceCode;
    const [node, ancestors] = findCurrentNode(
      sourceCode.ast,
      textDocument.offsetAt(params.position),
    );

    const results: DefinitionLink[] = await Promise.all(
      this.providers.map((provider) => provider.definitions(params, node, ancestors)),
    ).then((res) => res.flat());

    return results.length > 0 ? results : null;
  }
}
