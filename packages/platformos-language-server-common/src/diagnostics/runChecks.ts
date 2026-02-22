import {
  check,
  findRoot,
  makeFileExists,
  Offense,
  path,
  Reference,
  Severity,
  SourceCodeType,
} from '@platformos/platformos-check-common';

import { CSSLanguageService } from '../css/CSSLanguageService';
import { AugmentedSourceCode, DocumentManager } from '../documents';
import { Dependencies } from '../types';
import { DiagnosticsManager } from './DiagnosticsManager';
import { offenseSeverity } from './offenseToDiagnostic';
import { AppGraphManager } from '../server/AppGraphManager';

export function makeRunChecks(
  documentManager: DocumentManager,
  diagnosticsManager: DiagnosticsManager,
  {
    fs,
    loadConfig,
    platformosDocset,
    jsonValidationSet,
    cssLanguageService,
    appGraphManager,
    includeFilesFromDisk,
  }: Pick<Dependencies, 'fs' | 'loadConfig' | 'platformosDocset' | 'jsonValidationSet'> & {
    cssLanguageService?: CSSLanguageService;
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

      const cssOffenses = cssLanguageService
        ? await Promise.all(
            app.map((sourceCode) => getCSSDiagnostics(cssLanguageService, sourceCode)),
          ).then((offenses) => offenses.flat())
        : [];

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
      const offenses = [...appOffenses, ...cssOffenses];

      // We iterate over the app files (as opposed to offenses) because if
      // there were offenses before, we need to send an empty array to clear
      // them.
      for (const sourceCode of app) {
        const sourceCodeOffenses = offenses.filter((offense) => offense.uri === sourceCode.uri);
        diagnosticsManager.set(sourceCode.uri, sourceCode.version, sourceCodeOffenses);
      }
    }
  };
}

async function getCSSDiagnostics(
  cssLanguageService: CSSLanguageService,
  sourceCode: AugmentedSourceCode,
): Promise<Offense[]> {
  if (sourceCode.type !== SourceCodeType.LiquidHtml) {
    return [];
  }

  const diagnostics = await cssLanguageService.diagnostics({
    textDocument: { uri: sourceCode.uri },
  });

  return diagnostics
    .map(
      (diagnostic): Offense => ({
        check: 'css',
        message: diagnostic.message,
        end: {
          index: sourceCode.textDocument.offsetAt(diagnostic.range.end),
          line: diagnostic.range.end.line,
          character: diagnostic.range.end.character,
        },
        start: {
          index: sourceCode.textDocument.offsetAt(diagnostic.range.start),
          line: diagnostic.range.start.line,
          character: diagnostic.range.start.character,
        },
        severity: offenseSeverity(diagnostic),
        uri: sourceCode.uri,
        type: SourceCodeType.LiquidHtml,
      }),
    )
    .filter((offense) => offense.severity !== Severity.INFO);
}
