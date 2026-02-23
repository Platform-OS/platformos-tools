/// <reference lib="webworker" />
import { FileStat, FileTuple } from '@platformos/platformos-common';
import { path } from '@platformos/platformos-check-common';
import { commands, ExtensionContext, languages, Uri, workspace } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  DocumentSelector,
} from 'vscode-languageclient/browser';
import LiquidFormatter from '../common/formatter';
import { vscodePrettierFormat } from './formatter';
import { documentSelectors } from '../common/constants';
import { openLocation } from '../common/commands';
import {
  createReferencesTreeView,
  setupContext,
  watchReferencesTreeViewConfig,
} from '../common/ReferencesProvider';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  const runChecksCommand = 'platformosCheck/runChecks';

  context.subscriptions.push(
    commands.registerCommand('platformosLiquid.restart', () => restartServer(context)),
    commands.registerCommand('platformosLiquid.runChecks', () => {
      client!.sendRequest('workspace/executeCommand', { command: runChecksCommand });
    }),
    commands.registerCommand('platformosLiquid.openLocation', openLocation),
    languages.registerDocumentFormattingEditProvider(
      [{ language: 'liquid' }],
      new LiquidFormatter(vscodePrettierFormat),
    ),
  );

  await startServer(context);

  if (client) {
    setupContext();
    context.subscriptions.push(
      createReferencesTreeView('platformos.graph.references', context, client, 'references'),
      createReferencesTreeView('platformos.graph.dependencies', context, client, 'dependencies'),
      watchReferencesTreeViewConfig(),
    );
  }
}

export function deactivate() {
  return stopServer();
}

async function startServer(context: ExtensionContext) {
  console.log('Starting App Check Language Server');
  const clientOptions: LanguageClientOptions = {
    documentSelector: documentSelectors as DocumentSelector,
  };

  client = createWorkerLanguageClient(context, clientOptions);

  client.onRequest('fs/readDirectory', async (uriString: string): Promise<FileTuple[]> => {
    const results = await workspace.fs.readDirectory(Uri.parse(uriString));
    return results.map(([name, type]) => [path.join(uriString, name), type]);
  });

  const textDecoder = new TextDecoder();
  client.onRequest('fs/readFile', async (uriString: string): Promise<string> => {
    const bytes = await workspace.fs.readFile(Uri.parse(uriString));
    return textDecoder.decode(bytes);
  });

  client.onRequest('fs/stat', async (uriString: string): Promise<FileStat> => {
    return workspace.fs.stat(Uri.parse(uriString));
  });

  client.start();
  console.log('App Check Language Server started');
}

function createWorkerLanguageClient(
  context: ExtensionContext,
  clientOptions: LanguageClientOptions,
) {
  // Create a worker. The worker main file implements the language server.
  const serverMain = Uri.joinPath(context.extensionUri, 'dist', 'browser', 'server.js');
  const worker = new Worker(serverMain.toString(true));

  // create the language server client to communicate with the server running in the worker
  return new LanguageClient('platformosLiquid', 'App Check Language Server', clientOptions, worker);
}

async function stopServer() {
  try {
    if (client) {
      await Promise.race([client.stop(), sleep(1000)]);
    }
  } catch (e) {
    console.error(e);
  } finally {
    client = undefined;
  }
}

async function restartServer(context: ExtensionContext) {
  if (client) {
    await stopServer();
  }
  await startServer(context);
}
