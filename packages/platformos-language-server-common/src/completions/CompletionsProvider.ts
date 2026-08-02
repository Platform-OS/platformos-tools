import {
  GetDocDefinitionForURI,
  SourceCodeType,
  PlatformOSDocset,
} from '@platformos/platformos-check-common';
import {
  type AbstractFileSystem,
  type DocumentsLocator,
  FileType,
  getAppPaths,
  getFileType,
  getModulePaths,
  MODULE_ROOTS,
  PlatformOSFileType,
} from '@platformos/platformos-common';
import { CompletionItem, CompletionParams } from 'vscode-languageserver';
import { URI, Utils } from 'vscode-uri';
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
    const typeSystem = new TypeSystem(platformosDocset, fs, documentsLocator, findAppRootURI);
    this.graphqlFieldCompletionProvider = new GraphQLFieldCompletionProvider(
      platformosDocset,
      documentManager,
    );

    // Build layout/policy name callbacks from fs+findAppRootURI when not explicitly provided
    let layoutNames: GetLayoutNamesForURI | undefined = getLayoutNamesForURI;
    let authPolicyNames: GetAuthPolicyNamesForURI | undefined = getAuthPolicyNamesForURI;

    if (fs && findAppRootURI) {
      if (!layoutNames) {
        layoutNames = async (uri: string) => {
          const rootUri = await findAppRootURI(uri);
          if (!rootUri) return [];
          return listLayoutNames(fs, URI.parse(rootUri));
        };
      }
      if (!authPolicyNames) {
        authPolicyNames = async (uri: string) => {
          const rootUri = await findAppRootURI(uri);
          if (!rootUri) return [];
          return listAuthPolicyNames(fs, URI.parse(rootUri));
        };
      }
    }

    // Classification needs the project root, and finding a file's root is an async
    // walk only the server can do — so the providers that classify take this rather
    // than calling an unanchored `getFileType(uri)`.
    const fileTypeForURI = findAppRootURI
      ? async (uri: string) => {
          const rootUri = await findAppRootURI(uri);
          return rootUri ? getFileType(uri, rootUri) : undefined;
        }
      : undefined;

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
      new LiquidDocTagCompletionProvider(findAppRootURI),
      new LiquidDocParamTypeCompletionProvider(platformosDocset, findAppRootURI),
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

// ── File listing helpers ─────────────────────────────────────────────────────

/** Recursively list .liquid files under a URI directory. Returns full URI strings. */
async function listLiquidFilesRecursively(fs: AbstractFileSystem, dirUri: URI): Promise<string[]> {
  let entries: [string, FileType][];
  try {
    entries = await fs.readDirectory(dirUri.toString());
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const [entryUri, entryType] of entries) {
    if (entryType === FileType.Directory) {
      const sub = await listLiquidFilesRecursively(fs, URI.parse(entryUri));
      results.push(...sub);
    } else if (entryType === FileType.File && entryUri.endsWith('.liquid')) {
      results.push(entryUri);
    }
  }
  return results;
}

async function listLayoutNames(fs: AbstractFileSystem, root: URI): Promise<string[]> {
  const names: string[] = [];

  // App layouts. Where those live is platformos-common's business.
  for (const layoutDir of getAppPaths(PlatformOSFileType.Layout)) {
    const dir = Utils.joinPath(root, layoutDir);
    const base = dir.toString() + '/';
    for (const uri of await listLiquidFilesRecursively(fs, dir)) {
      const rel = uri.startsWith(base) ? uri.slice(base.length) : uri;
      names.push(rel.replace(/\.liquid$/, ''));
    }
  }

  // Module layouts. `getModulePaths` covers both `modules/` and `app/modules/`
  // (overwrites) and both access levels; each is reported as modules/{mod}/{rest}, so
  // the Set below deduplicates an overwrite against its original.
  for (const modName of await listModuleNames(fs, root)) {
    for (const layoutDir of getModulePaths(PlatformOSFileType.Layout, modName)) {
      const dir = Utils.joinPath(root, layoutDir);
      const base = dir.toString() + '/';
      for (const uri of await listLiquidFilesRecursively(fs, dir)) {
        const rest = uri.startsWith(base) ? uri.slice(base.length) : uri;
        names.push(`modules/${modName}/${rest.replace(/\.liquid$/, '')}`);
      }
    }
  }

  return [...new Set(names)].sort();
}

/** The module names present under either module root. */
async function listModuleNames(fs: AbstractFileSystem, root: URI): Promise<string[]> {
  const names = new Set<string>();

  for (const modulesRoot of MODULE_ROOTS) {
    let entries: [string, FileType][] = [];
    try {
      entries = await fs.readDirectory(Utils.joinPath(root, modulesRoot).toString());
    } catch {
      continue; // directory does not exist
    }
    for (const [uri, type] of entries) {
      if (type !== FileType.Directory) continue;
      names.add(uri.replace(/\/$/, '').split('/').at(-1)!);
    }
  }

  return [...names];
}

async function listAuthPolicyNames(fs: AbstractFileSystem, root: URI): Promise<string[]> {
  const dir = Utils.joinPath(root, getAppPaths(PlatformOSFileType.Authorization)[0]);
  let entries: [string, FileType][] = [];
  try {
    entries = await fs.readDirectory(dir.toString());
  } catch {
    return [];
  }

  return entries
    .filter(([uri, type]) => type === FileType.File && uri.endsWith('.liquid'))
    .map(([uri]) =>
      uri
        .replace(/\/$/, '')
        .split('/')
        .at(-1)!
        .replace(/\.liquid$/, ''),
    )
    .sort();
}
