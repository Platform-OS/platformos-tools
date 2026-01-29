import {
  GetDocDefinitionForURI,
  MetafieldDefinitionMap,
  SourceCodeType,
  ThemeDocset,
} from '@platformos/platformos-check-common';
import { AbstractFileSystem, DocumentsLocator } from '@platformos/platformos-common';
import { CompletionItem, CompletionParams } from 'vscode-languageserver';
import { TypeSystem } from '../TypeSystem';
import { DocumentManager } from '../documents';
import { FindThemeRootURI } from '../internal-types';
import { GetThemeSettingsSchemaForURI } from '../settings';
import { GetTranslationsForURI } from '../translations';
import { createLiquidCompletionParams } from './params';
import {
  ContentForCompletionProvider,
  ContentForBlockTypeCompletionProvider,
  ContentForParameterCompletionProvider,
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
  RenderSnippetParameterCompletionProvider,
  TranslationCompletionProvider,
} from './providers';
import { GetPartialNamesForURI } from './providers/PartialCompletionProvider';

export interface CompletionProviderDependencies {
  documentManager: DocumentManager;
  themeDocset: ThemeDocset;
  getTranslationsForURI?: GetTranslationsForURI;
  getPartialNamesForURI?: GetPartialNamesForURI;
  getThemeSettingsSchemaForURI?: GetThemeSettingsSchemaForURI;
  getMetafieldDefinitions: (rootUri: string) => Promise<MetafieldDefinitionMap>;
  getDocDefinitionForURI?: GetDocDefinitionForURI;
  getThemeBlockNames?: (rootUri: string, includePrivate: boolean) => Promise<string[]>;
  /** File system for reading GraphQL files */
  fs?: AbstractFileSystem;
  /** Locator for finding documents by type */
  documentsLocator?: DocumentsLocator;
  /** Function to find the theme root URI for a given file */
  findThemeRootURI?: FindThemeRootURI;
  log?: (message: string) => void;
  /** Callback to notify when unable to infer properties for a variable */
  notifyUnableToInferProperties?: (variableName: string) => void;
}

export class CompletionsProvider {
  private providers: Provider[] = [];
  readonly documentManager: DocumentManager;
  readonly themeDocset: ThemeDocset;
  readonly log: (message: string) => void;

  constructor({
    documentManager,
    themeDocset,
    getMetafieldDefinitions,
    getTranslationsForURI = async () => ({}),
    getPartialNamesForURI = async () => [],
    getThemeSettingsSchemaForURI = async () => [],
    getDocDefinitionForURI = async (uri, _relativePath) => ({ uri }),
    getThemeBlockNames = async (_rootUri: string, _includePrivate: boolean) => [],
    fs,
    documentsLocator,
    findThemeRootURI,
    log = () => {},
    notifyUnableToInferProperties,
  }: CompletionProviderDependencies) {
    this.documentManager = documentManager;
    this.themeDocset = themeDocset;
    this.log = log;
    const typeSystem = new TypeSystem(
      themeDocset,
      getThemeSettingsSchemaForURI,
      getMetafieldDefinitions,
    );

    this.providers = [
      new ContentForCompletionProvider(),
      new ContentForBlockTypeCompletionProvider(getThemeBlockNames),
      new ContentForParameterCompletionProvider(getDocDefinitionForURI),
      new HtmlTagCompletionProvider(),
      new HtmlAttributeCompletionProvider(documentManager),
      new HtmlAttributeValueCompletionProvider(),
      new LiquidTagsCompletionProvider(themeDocset),
      new ObjectCompletionProvider(typeSystem),
      new ObjectAttributeCompletionProvider(
        typeSystem,
        fs,
        documentsLocator,
        findThemeRootURI,
        themeDocset,
        notifyUnableToInferProperties,
      ),
      new FilterCompletionProvider(typeSystem),
      new TranslationCompletionProvider(documentManager, getTranslationsForURI),
      new PartialCompletionProvider(getPartialNamesForURI),
      new RenderSnippetParameterCompletionProvider(getDocDefinitionForURI),
      new FilterNamedParameterCompletionProvider(themeDocset),
      new LiquidDocTagCompletionProvider(),
      new LiquidDocParamTypeCompletionProvider(themeDocset),
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
