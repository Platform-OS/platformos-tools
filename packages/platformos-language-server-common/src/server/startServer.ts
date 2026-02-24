import {
  AugmentedPlatformOSDocset,
  DocDefinition,
  findRoot as findConfigFileRoot,
  isError,
  makeFileExists,
  makeGetDefaultLocaleFileUri,
  memoize,
  path,
  SourceCodeType,
  UriString,
} from '@platformos/platformos-check-common';
import { TranslationProvider } from '@platformos/platformos-common';
import {
  Connection,
  FileChangeType,
  FileOperationRegistrationOptions,
  InitializeResult,
  ShowDocumentRequest,
  TextDocumentSyncKind,
} from 'vscode-languageserver';
import { ClientCapabilities } from '../ClientCapabilities';
import { CodeActionKinds, CodeActionsProvider } from '../codeActions';
import { Commands, ExecuteCommandProvider } from '../commands';
import { CompletionsProvider } from '../completions';
import { GetPartialNamesForURI } from '../completions/providers/PartialCompletionProvider';
import { DefinitionProvider } from '../definitions/DefinitionProvider';
import { DiagnosticsManager, makeRunChecks } from '../diagnostics';
import { DocumentHighlightsProvider } from '../documentHighlights/DocumentHighlightsProvider';
import { DocumentLinksProvider } from '../documentLinks';
import { AugmentedJsonSourceCode, DocumentManager } from '../documents';
import { OnTypeFormattingProvider } from '../formatting';
import { HoverProvider } from '../hover';
import { CSSLanguageService } from '../css/CSSLanguageService';
import { JSONLanguageService } from '../json/JSONLanguageService';
import { LinkedEditingRangesProvider } from '../linkedEditingRanges/LinkedEditingRangesProvider';
import { RenameProvider } from '../rename/RenameProvider';
import { RenameHandler } from '../renamed/RenameHandler';
import { GetTranslationsForURI } from '../translations';
import {
  Dependencies,
  AppGraphDependenciesRequest,
  AppGraphReferenceRequest,
  AppGraphRootRequest,
} from '../types';
import { debounce } from '../utils';
import { VERSION } from '../version';
import { CachedFileSystem } from './CachedFileSystem';
import { Configuration, INCLUDE_FILES_FROM_DISK } from './Configuration';
import { safe } from './safe';
import { AppGraphManager } from './AppGraphManager';
import { DocumentsLocator } from '@platformos/platformos-common';
import { relative } from '@platformos/platformos-check-common/src/path';
import { URI } from 'vscode-uri';

const defaultLogger = () => {};

/**
 * The `git:` VFS does not support the `fs.readDirectory` call and makes most things break.
 * `git` URIs are the ones you'd encounter when doing a git diff in VS Code. They're not
 * real files, they're just a way to represent changes in a git repository. As such, I don't
 * think we want to sync those in our document manager or try to offer document links, etc.
 *
 * A middleware would be nice but it'd be a bit of a pain to implement.
 */
const hasUnsupportedDocument = (params: any) => {
  return (
    'textDocument' in params &&
    'uri' in params.textDocument &&
    typeof params.textDocument.uri === 'string' &&
    (params.textDocument.uri.startsWith('git:') || params.textDocument.uri.startsWith('output:'))
  );
};

/**
 * This code runs in node and the browser, it can't talk to the file system
 * or make requests. Stuff like that should be injected.
 *
 * In browser, platformos-check-js wants these things:
 *   - fileExists(path)
 *   - defaultTranslations
 *
 * Which means we gotta provide 'em from here too!
 */
export function startServer(
  connection: Connection,
  {
    fs: injectedFs,
    loadConfig: injectedLoadConfig,
    log = defaultLogger,
    jsonValidationSet,
    platformosDocset: remotePlatformOSDocset,
  }: Dependencies,
) {
  const fs = new CachedFileSystem(injectedFs);
  const fileExists = makeFileExists(fs);
  const loadConfig = memoize(injectedLoadConfig, (uri: string) => uri);
  const clientCapabilities = new ClientCapabilities();
  const configuration = new Configuration(connection, clientCapabilities);

  const documentManager: DocumentManager = new DocumentManager(
    fs,
    connection,
    clientCapabilities,
    isValidSchema,
  );
  const appGraphManager = new AppGraphManager(connection, documentManager, fs, findAppRootURI);
  const diagnosticsManager = new DiagnosticsManager(connection);
  const documentsLocator = new DocumentsLocator(fs);
  const translationProvider = new TranslationProvider(fs);
  const documentLinksProvider = new DocumentLinksProvider(
    documentManager,
    findAppRootURI,
    documentsLocator,
    translationProvider,
  );
  const codeActionsProvider = new CodeActionsProvider(documentManager, diagnosticsManager);
  const onTypeFormattingProvider = new OnTypeFormattingProvider(
    documentManager,
    async function setCursorPosition(textDocument, position) {
      if (!clientCapabilities.hasShowDocumentSupport) return;
      connection.sendRequest(ShowDocumentRequest.type, {
        uri: textDocument.uri,
        takeFocus: true,
        selection: {
          start: position,
          end: position,
        },
      });
    },
  );
  const linkedEditingRangesProvider = new LinkedEditingRangesProvider(documentManager);
  const documentHighlightProvider = new DocumentHighlightsProvider(documentManager);
  const renameProvider = new RenameProvider(
    connection,
    clientCapabilities,
    documentManager,
    findAppRootURI,
  );
  const renameHandler = new RenameHandler(
    connection,
    clientCapabilities,
    documentManager,
    findAppRootURI,
  );

  async function findAppRootURI(uri: string): Promise<string | null> {
    const rootUri = await findConfigFileRoot(uri, fileExists);
    if (!rootUri) return null;
    const config = await loadConfig(rootUri, fs);
    return config.rootUri;
  }

  // These are augmented here so that the caching is maintained over different runs.
  const platformosDocset = new AugmentedPlatformOSDocset(remotePlatformOSDocset);
  const runChecks = debounce(
    makeRunChecks(documentManager, diagnosticsManager, {
      fs,
      loadConfig,
      platformosDocset,
      jsonValidationSet,
      appGraphManager,
      includeFilesFromDisk: () => configuration[INCLUDE_FILES_FROM_DISK],
    }),
    100,
  );

  // In platformOS, there are no built-in system translations. User-defined translations
  // are resolved via TranslationProvider at the point of lookup.
  const getTranslationsForURI: GetTranslationsForURI = async (_uri) => ({});

  const getDocDefinitionForURI = async (
    uri: UriString,
    name: string,
  ): Promise<DocDefinition | undefined> => {
    const rootUri = await findAppRootURI(uri);
    if (!rootUri) return undefined;

    const fileUri = await documentsLocator.locate(URI.parse(rootUri), 'render', name);
    if (!fileUri) return undefined;

    const file = documentManager.get(fileUri);

    if (!file || file.type !== SourceCodeType.LiquidHtml || isError(file.ast)) {
      return undefined;
    }

    return file.getLiquidDoc();
  };

  const getPartialNamesForURI: GetPartialNamesForURI = safe(
    async (uri: string, partial: string, type: string | undefined) => {
      const rootUri = await findAppRootURI(uri);
      if (!rootUri) return [];

      return await documentsLocator.list(URI.parse(rootUri), type, partial);
    },
    [],
  );

  // Defined as a function to solve a circular dependency (doc manager & json
  // lang service both need each other)
  async function isValidSchema(uri: string, jsonString: string) {
    return jsonLanguageService.isValidSchema(uri, jsonString);
  }

  const getDefaultLocaleFileUri = makeGetDefaultLocaleFileUri(fs);
  async function getDefaultLocaleSourceCode(uri: string) {
    const rootUri = await findAppRootURI(uri);
    if (!rootUri) return null;

    const defaultLocaleFileUri = await getDefaultLocaleFileUri(rootUri);
    if (!defaultLocaleFileUri) return null;

    return (documentManager.get(defaultLocaleFileUri) as AugmentedJsonSourceCode) ?? null;
  }

  const definitionsProvider = new DefinitionProvider(documentManager, getDefaultLocaleSourceCode);
  const jsonLanguageService = new JSONLanguageService(documentManager, jsonValidationSet);
  const cssLanguageService = new CSSLanguageService(documentManager);
  const completionsProvider = new CompletionsProvider({
    documentManager,
    platformosDocset,
    getTranslationsForURI,
    getPartialNamesForURI,
    log,
    getDocDefinitionForURI,
    fs,
    documentsLocator,
    findAppRootURI,
    notifyUnableToInferProperties: (variableName: string) => {
      connection.window.showInformationMessage(
        `Unable to infer properties for '${variableName}'. Property completion is only supported for variables from parse_json, to_hash, or graphql.`,
      );
    },
  });
  const hoverProvider = new HoverProvider(
    documentManager,
    platformosDocset,
    translationProvider,
    getTranslationsForURI,
    getDocDefinitionForURI,
    findAppRootURI,
  );

  const executeCommandProvider = new ExecuteCommandProvider(
    documentManager,
    diagnosticsManager,
    clientCapabilities,
    runChecks,
    connection,
  );

  connection.onInitialize((params) => {
    clientCapabilities.setup(params.capabilities, params.initializationOptions);
    jsonLanguageService.setup(params.capabilities);
    cssLanguageService.setup(params.capabilities);
    configuration.setup();

    const fileOperationRegistrationOptions: FileOperationRegistrationOptions = {
      filters: [
        {
          pattern: {
            glob: '**/*.{liquid,json,graphql}',
          },
        },
        {
          pattern: {
            glob: '**/assets/*',
          },
        },
      ],
    };

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: {
          change: TextDocumentSyncKind.Full,
          save: true,
          openClose: true,
        },
        codeActionProvider: {
          codeActionKinds: [...CodeActionKinds],
        },
        completionProvider: {
          triggerCharacters: ['.', '{{ ', '{% ', '<', '/', '[', '"', "'", ':', '@'],
        },
        definitionProvider: true,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: ' ',
          moreTriggerCharacter: ['{', '%', '-', '>'],
        },
        documentLinkProvider: {
          resolveProvider: false,
          workDoneProgress: false,
        },
        documentHighlightProvider: true,
        linkedEditingRangeProvider: true,
        renameProvider: {
          prepareProvider: true,
        },
        executeCommandProvider: {
          commands: [...Commands],
        },
        hoverProvider: {
          workDoneProgress: false,
        },
        workspace: {
          workspaceFolders: {
            supported: true,
            changeNotifications: true,
          },
          fileOperations: {
            didRename: fileOperationRegistrationOptions,
          },
        },
      },
      serverInfo: {
        name: 'platformos-language-server',
        version: VERSION,
      },
    };

    return result;
  });

  connection.onInitialized(() => {
    log(`[SERVER] Let's roll!`);
    configuration.fetchConfiguration();
    configuration.registerDidChangeCapability();
    configuration.registerDidChangeWatchedFilesNotification({
      watchers: [
        {
          globPattern: '**/*.liquid',
        },
        {
          globPattern: '**/translations/**/*.yml',
        },
        {
          globPattern: '**/*.graphql',
        },
        {
          globPattern: '**/*.css',
        },
      ],
    });
  });

  connection.onDidChangeConfiguration((_params) => {
    configuration.clearCache();
  });

  connection.onDidOpenTextDocument(async (params) => {
    if (hasUnsupportedDocument(params)) return;
    const { uri, text, version } = params.textDocument;
    if (uri.endsWith('.css')) {
      cssLanguageService.open(uri, text, version);
      return;
    }
    documentManager.open(uri, text, version);
    if (await configuration.shouldCheckOnOpen()) {
      runChecks([uri]);
    }

    // The objective at the time of writing this is to make {Asset,Snippet}Rename
    // fast when you eventually need it.
    //
    // I'm choosing the textDocument/didOpen notification as a hook because
    // I'm not sure we have a better solution than this. Yes we have the
    // initialize request with the workspace folders, but you might have opened
    // an app folder. The root of a theme app extension would probably be
    // at ${workspaceRoot}/extensions/${appExtensionName}. It'd be hard to
    // figure out from the initialize request params.
    //
    // If we open a file that we know is liquid, then we can kind of guarantee
    // we'll find an app root and we'll preload that.
    if (await configuration.shouldPreloadOnBoot()) {
      const rootUri = await findAppRootURI(uri);
      if (rootUri) {
        documentManager.preload(rootUri);
      }
    }
  });

  connection.onDidChangeTextDocument(async (params) => {
    if (hasUnsupportedDocument(params)) return;
    const { uri, version } = params.textDocument;
    if (uri.endsWith('.css')) {
      cssLanguageService.change(uri, params.contentChanges[0].text, version);
      return;
    }
    documentManager.change(uri, params.contentChanges[0].text, version);
    if (await configuration.shouldCheckOnChange()) {
      runChecks([uri]);
    } else {
      // The diagnostics may be stale! Clear em!
      diagnosticsManager.clear(params.textDocument.uri);
    }
  });

  connection.onDidSaveTextDocument(async (params) => {
    if (hasUnsupportedDocument(params)) return;
    const { uri } = params.textDocument;
    if (await configuration.shouldCheckOnSave()) {
      runChecks([uri]);
    }
  });

  connection.onDidCloseTextDocument((params) => {
    if (hasUnsupportedDocument(params)) return;
    const { uri } = params.textDocument;
    if (uri.endsWith('.css')) {
      cssLanguageService.close(uri);
      return;
    }
    documentManager.close(uri);
    diagnosticsManager.clear(uri);
  });

  connection.onDocumentLinks(async (params) => {
    if (hasUnsupportedDocument(params)) return [];

    const [liquidLinks, jsonLinks] = await Promise.all([
      documentLinksProvider.documentLinks(params.textDocument.uri),
      jsonLanguageService.documentLinks(params),
    ]);

    return [...liquidLinks, ...jsonLinks];
  });

  connection.onDefinition(async (params) => {
    if (hasUnsupportedDocument(params)) return [];
    return definitionsProvider.definitions(params);
  });

  connection.onCodeAction(async (params) => {
    return codeActionsProvider.codeActions(params);
  });

  connection.onExecuteCommand(async (params) => {
    await executeCommandProvider.execute(params);
  });

  connection.onCompletion(async (params) => {
    if (hasUnsupportedDocument(params)) return [];
    return (
      (await cssLanguageService.completions(params)) ??
      (await jsonLanguageService.completions(params)) ??
      (await completionsProvider.completions(params))
    );
  });

  connection.onHover(async (params) => {
    if (hasUnsupportedDocument(params)) return null;
    return (
      (await cssLanguageService.hover(params)) ??
      (await jsonLanguageService.hover(params)) ??
      (await hoverProvider.hover(params))
    );
  });

  connection.onDocumentOnTypeFormatting(async (params) => {
    if (hasUnsupportedDocument(params)) return null;
    return onTypeFormattingProvider.onTypeFormatting(params);
  });

  connection.onDocumentHighlight(async (params) => {
    if (hasUnsupportedDocument(params)) return [];
    return documentHighlightProvider.documentHighlights(params);
  });

  connection.onPrepareRename(async (params) => {
    if (hasUnsupportedDocument(params)) return null;
    return renameProvider.prepare(params);
  });

  connection.onRenameRequest(async (params) => {
    if (hasUnsupportedDocument(params)) return null;
    return renameProvider.rename(params);
  });

  connection.languages.onLinkedEditingRange(async (params) => {
    if (hasUnsupportedDocument(params)) return null;
    return linkedEditingRangesProvider.linkedEditingRanges(params);
  });

  connection.workspace.onDidRenameFiles(async (params) => {
    const triggerUris = params.files.map((fileRename) => fileRename.newUri);

    // Behold the cache invalidation monster
    for (const { oldUri, newUri } of params.files) {
      // When a file is renamed, we paste the content of the old file into the
      // new file in the document manager. We don't need to invalidate preload
      // because that's the only thing that changed.
      documentManager.rename(oldUri, newUri);

      // When a file is renamed, readDirectory to the parent folder is invalidated.
      fs.readDirectory.invalidate(path.dirname(oldUri));
      fs.readDirectory.invalidate(path.dirname(newUri));

      // When a file is renamed, readFile and stat for both the old and new URIs are invalidated.
      fs.readFile.invalidate(oldUri);
      fs.readFile.invalidate(newUri);
      fs.stat.invalidate(oldUri);
      fs.stat.invalidate(newUri);

      appGraphManager.rename(oldUri, newUri);
    }

    await renameHandler.onDidRenameFiles(params);

    // MissingAssets/MissingPartial should be rerun when a file is deleted
    // since the file rename might cause an error.
    runChecks.force(triggerUris);
  });

  /**
   * onDidChangeWatchedFiles is triggered by file operations (in or out of the editor).
   *
   * For in-editor changes, happens redundantly with
   *   - onDidCreateFiles
   *   - onDidRenameFiles
   *   - onDidDeleteFiles
   *   - onDidSaveTextDocument
   *
   * Not redundant for operations that happen outside of the editor
   *   - git pull, checkout, reset, stash pop, etc.
   *   - etc.
   *
   * It always runs and onDid* will never fire without a corresponding onDidChangeWatchedFiles.
   *
   * This is why the bulk of the cache invalidation logic is in this handler.
   */
  connection.onDidChangeWatchedFiles(async (params) => {
    if (params.changes.length === 0) return;

    const triggerUris = params.changes.map((change) => change.uri);
    const updates: Promise<any>[] = [];
    for (const change of params.changes) {
      // App Check config changes should clear the config cache
      if (change.uri.endsWith('.platformos-check.yml')) {
        loadConfig.clearCache();
        continue;
      }

      // Rename cache invalidation is handled by onDidRenameFiles
      if (documentManager.hasRecentRename(change.uri)) {
        documentManager.clearRecentRename(change.uri);
        continue;
      }

      switch (change.type) {
        case FileChangeType.Created:
          // A created file invalidates readDirectory, readFile and stat
          fs.readDirectory.invalidate(path.dirname(change.uri));
          fs.readFile.invalidate(change.uri);
          fs.stat.invalidate(change.uri);
          appGraphManager.create(change.uri);
          // If a file is created under out feet, we update its contents.
          updates.push(documentManager.changeFromDisk(change.uri));
          break;

        case FileChangeType.Changed:
          // A changed file invalidates readFile and stat (but not readDirectory)
          fs.readFile.invalidate(change.uri);
          fs.stat.invalidate(change.uri);
          appGraphManager.change(change.uri);
          // If the file is not open, we update its contents in the doc manager
          // If it is open, then we don't need to update it because the document manager
          // will have the version from the editor.
          if (documentManager.get(change.uri)?.version === undefined) {
            updates.push(documentManager.changeFromDisk(change.uri));
          }
          break;

        case FileChangeType.Deleted:
          // A deleted file invalides readDirectory, readFile, and stat
          fs.readDirectory.invalidate(path.dirname(change.uri));
          fs.readFile.invalidate(change.uri);
          fs.stat.invalidate(change.uri);
          appGraphManager.delete(change.uri);
          // If a file is deleted, it's removed from the document manager
          documentManager.delete(change.uri);
          break;
      }

      // metafields.json support removed
    }

    await Promise.all(updates);

    // MissingAssets/MissingPartial should be rerun when a file is deleted
    // since an error might be introduced (and vice versa).
    runChecks.force(triggerUris);
  });

  connection.onRequest(AppGraphReferenceRequest.type, async (params) => {
    if (hasUnsupportedDocument(params)) return [];
    const { uri, offset, includeIndirect } = params;
    return appGraphManager.getReferences(uri, offset, { includeIndirect }).catch((_) => []);
  });

  connection.onRequest(AppGraphDependenciesRequest.type, async (params) => {
    if (hasUnsupportedDocument(params)) return [];
    const { uri, offset, includeIndirect } = params;
    return appGraphManager.getDependencies(uri, offset, { includeIndirect }).catch((_) => []);
  });

  connection.onRequest(AppGraphRootRequest.type, async (params) => {
    if (hasUnsupportedDocument(params)) return '';
    const { uri } = params;
    const rootUri = await findAppRootURI(uri).catch((_) => undefined);
    if (!rootUri || path.dirname(rootUri) === rootUri) {
      console.error(uri);
    }
    return rootUri;
  });

  connection.listen();
}
