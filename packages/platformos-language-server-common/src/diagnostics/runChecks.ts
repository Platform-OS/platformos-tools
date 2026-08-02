import {
  check,
  findRoot,
  makeFileExists,
  path,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { RouteTable } from '@platformos/platformos-common';

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

      // The cross-file checks are only as good as the app behind them:
      // `PartialCallArguments` reads the target partial's `{% doc %}` through
      // `getDocDefinition` below, which finds nothing for a file the workspace has
      // not loaded yet. Preloading is what loads it, it is memoized per root, and
      // it is started in the background on `didOpen` — so this usually resolves
      // immediately and, on the very first check of a session, waits for the read
      // it would otherwise silently report around.
      //
      // Silently, because a missing partial produces no offense rather than a
      // wrong one: before the App model made the preload cheap it took 17 s on a
      // 2700-file project and monopolised the event loop, so the first check could
      // not run until it was over and the race never showed. `preload` reports its
      // own failures — an unreadable directory must cost the project its cross-file
      // diagnostics, not all of them.
      await documentManager.preload(config.rootUri).catch(() => {});

      const app = documentManager.app(config.rootUri, includeFilesFromDisk?.());

      const appOffenses = await check(app, config, {
        fs,
        platformosDocset,
        jsonValidationSet,
        routeTable: getRouteTable?.(),

        async getDocDefinition(relativePath) {
          const uri = path.join(config.rootUri, relativePath);
          const doc = documentManager.get(uri);
          if (doc?.type !== SourceCodeType.LiquidHtml) return undefined;
          return doc.getLiquidDoc();
        },
      });

      // We iterate over the app files (as opposed to offenses) because if
      // there were offenses before, we need to send an empty array to clear
      // them: every file in the app is visited and published, so an offense that no
      // longer exists is cleared rather than left on screen.
      for (const sourceCode of app) {
        const sourceCodeOffenses = appOffenses.filter((offense) => offense.uri === sourceCode.uri);
        diagnosticsManager.set(sourceCode.uri, sourceCode.version, sourceCodeOffenses);
      }
    }
  };
}
