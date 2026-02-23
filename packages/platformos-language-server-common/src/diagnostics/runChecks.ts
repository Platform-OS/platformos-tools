import {
  check,
  findRoot,
  makeFileExists,
  path,
  Reference,
  SourceCodeType,
} from '@platformos/platformos-check-common';

import { DocumentManager } from '../documents';
import { Dependencies } from '../types';
import { DiagnosticsManager } from './DiagnosticsManager';
import { AppGraphManager } from '../server/AppGraphManager';

export function makeRunChecks(
  documentManager: DocumentManager,
  diagnosticsManager: DiagnosticsManager,
  {
    fs,
    loadConfig,
    platformosDocset,
    jsonValidationSet,
    appGraphManager,
    includeFilesFromDisk,
  }: Pick<
    Dependencies,
    'fs' | 'loadConfig' | 'platformosDocset' | 'jsonValidationSet'
  > & {
    appGraphManager?: AppGraphManager;
    includeFilesFromDisk?: () => boolean;
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
      const app = documentManager.app(config.rootUri, includeFilesFromDisk?.());

      const appOffenses = await check(app, config, {
        fs,
        platformosDocset,
        jsonValidationSet,

        async getReferences(uri: string): Promise<Reference[]> {
          if (!appGraphManager) return [];
          return appGraphManager.getReferences(uri);
        },

        async getDocDefinition(relativePath) {
          const uri = path.join(config.rootUri, relativePath);
          const doc = documentManager.get(uri);
          if (doc?.type !== SourceCodeType.LiquidHtml) return undefined;
          return doc.getLiquidDoc();
        },
      });

      // We iterate over the app files (as opposed to offenses) because if
      // there were offenses before, we need to send an empty array to clear
      // them.
      for (const sourceCode of app) {
        const sourceCodeOffenses = appOffenses.filter((offense) => offense.uri === sourceCode.uri);
        diagnosticsManager.set(sourceCode.uri, sourceCode.version, sourceCodeOffenses);
      }
    }
  };
}
