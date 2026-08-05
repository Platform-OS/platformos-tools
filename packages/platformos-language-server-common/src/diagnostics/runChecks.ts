import {
  check,
  findRoot,
  makeFileExists,
  path,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { RouteTable } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

import { DocumentManager } from '../documents';
import { Dependencies } from '../types';
import { DiagnosticsManager } from './DiagnosticsManager';

export function makeRunChecks(
  documentManager: DocumentManager,
  diagnosticsManager: DiagnosticsManager,
  {
    fs,
    loadConfig,
    platformosDocset,
    jsonValidationSet,
    includeFilesFromDisk,
    getRouteTable,
  }: Pick<Dependencies, 'fs' | 'loadConfig' | 'platformosDocset' | 'jsonValidationSet'> & {
    includeFilesFromDisk?: () => boolean;
    getRouteTable?: () => RouteTable | undefined;
  },
) {
  return async function runChecks(triggerURIs: string[]): Promise<void> {
    // This function takes an array of triggerURIs so that we can correctly
    // recheck on file renames that came from out of bounds in a
    // workspaces.
    //
    // e.g. if a user renames
    //  app1/app/views/partials/a.liquid to
    //  app1/app/views/partials/b.liquid
    //
    // then we recheck app1
    const fileExists = makeFileExists(fs);
    const rootURIs = await Promise.all(triggerURIs.map((uri) => findRoot(uri, fileExists)));
    const deduplicatedRootURIs = new Set<string>(rootURIs.filter((x): x is string => !!x));
    await Promise.all([...deduplicatedRootURIs].map(runChecksForRoot));

    return;

    async function runChecksForRoot(configFileRootUri: string) {
      const config = await loadConfig(configFileRootUri, fs);

      // The server's persistent, event-maintained table, as the PROVIDER shape
      // `Dependencies.routeTable` requires. The provider owns currency, so it is
      // this wrapper — not check-common — that builds the table on first use when
      // no definition request got there first. Fetched per run, so a table the
      // definitions provider swapped out (bulk invalidation) is picked up.
      const editorRouteTable = getRouteTable?.();
      const routeTable = editorRouteTable
        ? async () => {
            if (!editorRouteTable.isBuilt()) {
              await editorRouteTable.build(URI.parse(config.rootUri));
            }
            return editorRouteTable;
          }
        : undefined;

      // The cross-file checks are only as good as the app behind them:
      // `PartialCallArguments` reads the target partial's `{% doc %}` through
      // `getDocDefinition` below, which finds nothing for a file the workspace has
      // not loaded yet. Preloading is what loads it, it is memoized per root, and
      // it is started in the background on `didOpen` — so this usually resolves
      // immediately and, on the very first check of a session, waits for the read
      // it would otherwise silently report around.
      //
      // Silently, because a missing partial produces no offense rather than a wrong one.
      // `preload` reports its own failures — an unreadable directory must cost the project
      // its cross-file diagnostics, not all of them.
      await documentManager.preload(config.rootUri).catch(() => {});

      // ONE list, used twice: it says which files get visited and which files get
      // their diagnostics published. Asking `documentManager` again after the await
      // would answer from live state — a buffer closed during the run would keep its
      // diagnostics on screen, and one opened during it would be published an empty
      // array for a file nothing looked at.
      const documents = documentManager.app(config.rootUri, includeFilesFromDisk?.());

      const appOffenses = await check(
        // The MODEL, not the list of documents. It is what fills `context.app`, and
        // that is what lets a `{% render %}` / `{% graphql %}` / `{% asset %}` name
        // resolve through the app's index instead of a `stat` per candidate path, and
        // `context.fileType` read a type the file derived once. The editor is where
        // that latency is felt, and it was the one consumer not getting it.
        documentManager.appModel(config.rootUri),
        config,
        {
          fs,
          platformosDocset,
          jsonValidationSet,
          routeTable,

          async getDocDefinition(relativePath) {
            const uri = path.join(config.rootUri, relativePath);
            const doc = documentManager.get(uri);
            if (doc?.type !== SourceCodeType.LiquidHtml) return undefined;
            return doc.getLiquidDoc();
          },
        },
        // What gets VISITED is unchanged: `documentManager.app`'s filters — readable,
        // and (unless `includeFilesFromDisk`) an open buffer. Handing over the model
        // widens what the checks can SEE, not what they report on.
        //
        // `[]` is meant literally and must not be collapsed to `undefined`: no open
        // buffer under this root has always meant "visit nothing" here, while
        // `undefined` would lint the whole preloaded project on every keystroke.
        { only: documents.map((document) => document.uri) },
      );

      // We iterate over the documents (as opposed to offenses) because if
      // there were offenses before, we need to send an empty array to clear
      // them: every file that was visited is published, so an offense that no
      // longer exists is cleared rather than left on screen.
      //
      // `sourceCode.version` is read here, AFTER the await, and deliberately: these
      // are the `AppFile`s themselves, `version` is a getter, and the client drops a
      // diagnostics batch tagged with a version older than the buffer it holds.
      for (const sourceCode of documents) {
        const sourceCodeOffenses = appOffenses.filter((offense) => offense.uri === sourceCode.uri);
        diagnosticsManager.set(sourceCode.uri, sourceCode.version, sourceCodeOffenses);
      }
    }
  };
}
