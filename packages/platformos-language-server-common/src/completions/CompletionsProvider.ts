import {
  GetDocDefinitionForURI,
  SourceCodeType,
  PlatformOSDocset,
} from '@platformos/platformos-check-common';
import {
  type AbstractFileSystem,
  type DocumentsLocator,
  PlatformOSFileType,
} from '@platformos/platformos-common';
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
  FrontmatterKeyCompletionProvider,
  GetLayoutNamesForURI,
  GetAuthPolicyNamesForURI,
} from './providers';
import { GetPartialNamesForURI } from './providers/PartialCompletionProvider';
import { GraphQLFieldCompletionProvider } from './providers/GraphQLFieldCompletionProvider';

export interface CompletionProviderDependencies {
  documentManager: DocumentManager;
  platformosDocset: PlatformOSDocset;
  getTranslationsForURI?: GetTranslationsForURI;
  getPartialNamesForURI?: GetPartialNamesForURI;
  getDocDefinitionForURI?: GetDocDefinitionForURI;
  /** File system for reading GraphQL files and listing frontmatter-referenced files */
  fs?: AbstractFileSystem;
  /** Locator for finding documents by type */
  documentsLocator?: DocumentsLocator;
  /** Function to find the app root URI for a given file */
  findAppRootURI?: FindAppRootURI;
  log?: (message: string) => void;
  /** Callback to notify when unable to infer properties for a variable */
  notifyUnableToInferProperties?: (variableName: string) => void;
  /** Override for listing available layout names (used in frontmatter value completions) */
  getLayoutNamesForURI?: GetLayoutNamesForURI;
  /** Override for listing available authorization policy names */
  getAuthPolicyNamesForURI?: GetAuthPolicyNamesForURI;
}

export class CompletionsProvider {
  private providers: Provider[] = [];
  private graphqlFieldCompletionProvider: GraphQLFieldCompletionProvider;
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
    getLayoutNamesForURI,
    getAuthPolicyNamesForURI,
  }: CompletionProviderDependencies) {
    this.documentManager = documentManager;
    this.platformosDocset = platformosDocset;
    this.log = log;
    // The App per project root, so the type system reads a `.graphql` document from the
    // same `AppFile` the diagnostics parsed rather than reading and parsing it again per
    // call site, per completion request.
    const typeSystem = new TypeSystem(
      platformosDocset,
      fs,
      documentsLocator,
      findAppRootURI,
      (root) => documentManager.appModel(root),
      // Object scope depends on the file's type — `data` belongs to an api_call, `content_for_layout`
      // to a layout. The DocumentManager already holds it, so nothing re-derives it from the URI.
      (uri) => documentManager.fileType(uri),
    );
    this.graphqlFieldCompletionProvider = new GraphQLFieldCompletionProvider(
      platformosDocset,
      documentManager,
    );

    // Build layout/policy name callbacks from the App when not explicitly provided.
    // `AppFile.name` IS the completion label: the same `pathToName` that names the
    // index strips the type directory, the extension AND any response format, so a
    // layout at `app/views/layouts/1col.html.liquid` is offered as `1col` — the
    // spelling `layout:` resolves — where a hand-rolled `.replace(/\.liquid$/, '')`
    // offered `1col.html`, which resolves to nothing. Module files come back as
    // `modules/<name>/…` from the same derivation, and a Set collapses an
    // `app/modules/` overwrite onto its original.
    let layoutNames: GetLayoutNamesForURI | undefined = getLayoutNamesForURI;
    let authPolicyNames: GetAuthPolicyNamesForURI | undefined = getAuthPolicyNamesForURI;

    if (findAppRootURI) {
      const namesOfType = async (uri: string, fileType: PlatformOSFileType) => {
        const rootUri = await findAppRootURI(uri);
        if (!rootUri) return [];
        // Memoized per root and started in the background on didOpen, so this
        // resolves immediately except on the very first completion of a cold
        // workspace — where waiting for the read is what makes the answer right.
        // A failed preload leaves whatever the app already holds (open buffers).
        await documentManager.preload(rootUri).catch(() => {});
        const names = documentManager
          .appModel(rootUri)
          .ofType(fileType)
          .map((file) => file.name);
        return [...new Set(names)].sort();
      };

      layoutNames ??= (uri: string) => namesOfType(uri, PlatformOSFileType.Layout);
      authPolicyNames ??= (uri: string) => namesOfType(uri, PlatformOSFileType.Authorization);
    }

    // THE classifier: the DocumentManager answers from the AppFile a known root
    // already classified, and walks for a root only when none is known yet. The
    // providers that classify take this — one resolver, one meaning of "no root" —
    // rather than doing their own findAppRootURI-then-classify dance.
    const fileTypeForURI = (uri: string) => documentManager.fileType(uri);

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
      new LiquidDocTagCompletionProvider(platformosDocset, fileTypeForURI),
      new LiquidDocParamTypeCompletionProvider(platformosDocset, fileTypeForURI),
      new FrontmatterKeyCompletionProvider(layoutNames, authPolicyNames, fileTypeForURI),
    ];
  }

  async completions(params: CompletionParams): Promise<CompletionItem[]> {
    const uri = params.textDocument.uri;
    const document = this.documentManager.get(uri);

    // GraphQL files get dedicated completion support
    if (document?.type === SourceCodeType.GraphQL) {
      return this.graphqlFieldCompletionProvider.completions(params);
    }

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
