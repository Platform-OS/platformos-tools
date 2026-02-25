import {
  GetDocDefinitionForURI,
  SourceCodeType,
  PlatformOSDocset,
} from '@platformos/platformos-check-common';
import type { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { CompletionItem, CompletionParams } from 'vscode-languageserver';
import { TypeSystem } from '../TypeSystem';
import { DocumentManager } from '../documents';
import { FindAppRootURI } from '../internal-types';
import { GetTranslationsForURI } from '../translations';
import { createLiquidCompletionParams } from './params';
import {
  FilterCompletionProvider,
  FilterNamedParameterCompletionProvider,
  HtmlAttributeCompletionProvider,
  HtmlAttributeValueCompletionProvider,
  HtmlTagCompletionProvider,
  LiquidDocParamTypeCompletionProvider,
  LiquidDocTagCompletionProvider,
  LiquidTagsCompletionProvider,
  ObjectAttributeCompletionProvider,
  ObjectCompletionProvider,
  Provider,
  PartialCompletionProvider,
  RenderPartialParameterCompletionProvider,
  TranslationCompletionProvider,
} from './providers';
import { GetPartialNamesForURI } from './providers/PartialCompletionProvider';

export interface CompletionProviderDependencies {
  documentManager: DocumentManager;
  platformosDocset: PlatformOSDocset;
  getTranslationsForURI?: GetTranslationsForURI;
  getPartialNamesForURI?: GetPartialNamesForURI;
  getDocDefinitionForURI?: GetDocDefinitionForURI;
  /** File system for reading GraphQL files */
  fs?: AbstractFileSystem;
  /** Locator for finding documents by type */
  documentsLocator?: DocumentsLocator;
  /** Function to find the app root URI for a given file */
  findAppRootURI?: FindAppRootURI;
  log?: (message: string) => void;
  /** Callback to notify when unable to infer properties for a variable */
  notifyUnableToInferProperties?: (variableName: string) => void;
}

export class CompletionsProvider {
  private providers: Provider[] = [];
  readonly documentManager: DocumentManager;
  readonly platformosDocset: PlatformOSDocset;
  readonly log: (message: string) => void;

  constructor({
    documentManager,
    platformosDocset,
    getTranslationsForURI = async () => ({}),
    getPartialNamesForURI = async () => [],
    getDocDefinitionForURI = async (uri, _partialName) => ({ uri }),
    fs,
    documentsLocator,
    findAppRootURI,
    log = () => {},
  }: CompletionProviderDependencies) {
    this.documentManager = documentManager;
    this.platformosDocset = platformosDocset;
    this.log = log;
    const typeSystem = new TypeSystem(platformosDocset, fs, documentsLocator, findAppRootURI);

    this.providers = [
      new HtmlTagCompletionProvider(),
      new HtmlAttributeCompletionProvider(documentManager),
      new HtmlAttributeValueCompletionProvider(),
      new LiquidTagsCompletionProvider(platformosDocset),
      new ObjectCompletionProvider(typeSystem),
      new ObjectAttributeCompletionProvider(typeSystem),
      new FilterCompletionProvider(typeSystem),
      new TranslationCompletionProvider(documentManager, getTranslationsForURI),
      new PartialCompletionProvider(getPartialNamesForURI),
      new RenderPartialParameterCompletionProvider(getDocDefinitionForURI),
      new FilterNamedParameterCompletionProvider(platformosDocset),
      new LiquidDocTagCompletionProvider(),
      new LiquidDocParamTypeCompletionProvider(platformosDocset),
    ];
  }

  async completions(params: CompletionParams): Promise<CompletionItem[]> {
    const uri = params.textDocument.uri;
    const document = this.documentManager.get(uri);

    // Supports only Liquid resources
    if (document?.type !== SourceCodeType.LiquidHtml) {
      return [];
    }

    try {
      const liquidParams = createLiquidCompletionParams(document, params);
      const promises = this.providers.map((p) => p.completions(liquidParams));
      const results = await Promise.all(promises);
      this.log(JSON.stringify(results.flat()));
      return results.flat();
    } catch (err) {
      this.log(`[SERVER] CompletionsProvider error: ${err}`);
      return [];
    }
  }
}
