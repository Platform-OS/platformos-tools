import { findCurrentNode, SourceCodeType } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { DefinitionLink, DefinitionParams } from 'vscode-languageserver';

import { AugmentedJsonSourceCode, DocumentManager } from '../documents';
import { BaseDefinitionProvider } from './BaseDefinitionProvider';
import { PageRouteDefinitionProvider } from './providers/PageRouteDefinitionProvider';
import { TranslationStringDefinitionProvider } from './providers/TranslationStringDefinitionProvider';

export class DefinitionProvider {
  private providers: BaseDefinitionProvider[];
  private pageRouteProvider?: PageRouteDefinitionProvider;

  constructor(
    private documentManager: DocumentManager,
    getDefaultLocaleSourceCode: (uri: string) => Promise<AugmentedJsonSourceCode | null>,
    fs?: AbstractFileSystem,
    findAppRootURI?: (uri: string) => Promise<string | null>,
  ) {
    this.providers = [
      new TranslationStringDefinitionProvider(documentManager, getDefaultLocaleSourceCode),
    ];

    if (fs && findAppRootURI) {
      this.pageRouteProvider = new PageRouteDefinitionProvider(documentManager, fs, findAppRootURI);
      this.providers.push(this.pageRouteProvider);
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
