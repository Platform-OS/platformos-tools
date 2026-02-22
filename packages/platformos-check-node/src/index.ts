import {
  Config,
  DocDefinition,
  GraphQLSourceCode,
  JSONSourceCode,
  JSONValidator,
  LiquidSourceCode,
  Offense,
  App,
  toSourceCode as commonToSourceCode,
  check as coreCheck,
  extractDocDefinition,
  filePathSupportsLiquidDoc,
  isIgnored,
  memo,
  path as pathUtils,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';
import { PlatformOSLiquidDocsManager } from '@platformos/platformos-check-docs-updater';
import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';
import { glob } from 'glob';

import { autofix } from './autofix';
import { findConfigPath, loadConfig as resolveConfig } from './config';
import { NodeFileSystem } from './NodeFileSystem';
import { fileURLToPath } from 'node:url';

export * from '@platformos/platformos-check-common';
export * from './config/types';
export { NodeFileSystem };
export { runBackfillDocsCLI } from './backfill-docs';

export const loadConfig: typeof resolveConfig = async (configPath, root) => {
  configPath ??= await findConfigPath(root);
  return resolveConfig(configPath, root);
};

export type AppCheckRun = {
  app: App;
  config: Config;
  offenses: Offense[];
};

export async function toSourceCode(
  absolutePath: string,
): Promise<LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode | undefined> {
  try {
    const source = await fs.readFile(absolutePath, 'utf8');
    return commonToSourceCode(pathUtils.normalize(URI.file(absolutePath)), source);
  } catch (e) {
    return undefined;
  }
}

export async function check(root: string, configPath?: string): Promise<Offense[]> {
  const run = await appCheckRun(root, configPath);
  return run.offenses;
}

export async function checkAndAutofix(root: string, configPath?: string) {
  const { app, offenses } = await appCheckRun(root, configPath);
  await autofix(app, offenses);
}

export async function appCheckRun(
  root: string,
  configPath?: string,
  log: (message: string) => void = () => {},
): Promise<AppCheckRun> {
  const { app, config } = await getAppAndConfig(root, configPath);
  const platformOSLiquidDocsManager = new PlatformOSLiquidDocsManager(log);

  const validator = await JSONValidator.create(platformOSLiquidDocsManager, config);

  const docDefinitions = new Map(
    app.map((file) => [
      path.relative(URI.file(root).toString(), file.uri),
      memo(async (): Promise<DocDefinition | undefined> => {
        const ast = file.ast;
        if (!isLiquidHtmlNode(ast)) {
          return undefined;
        }
        if (!filePathSupportsLiquidDoc(file.uri)) {
          return undefined;
        }
        return extractDocDefinition(file.uri, ast);
      }),
    ]),
  );

  const offenses = await coreCheck(app, config, {
    fs: NodeFileSystem,
    platformosDocset: platformOSLiquidDocsManager,
    jsonValidationSet: platformOSLiquidDocsManager,
    getDocDefinition: async (relativePath) => docDefinitions.get(relativePath)?.(),
  });

  return {
    app,
    config,
    offenses,
  };
}

export async function getAppAndConfig(
  root: string,
  configPath?: string,
): Promise<{ app: App; config: Config }> {
  const config = await loadConfig(configPath, root);
  const app = await getApp(config);
  return {
    app,
    config,
  };
}

export async function getApp(config: Config): Promise<App> {
  // On windows machines - the separator provided by path.join is '\'
  // however the glob function fails silently since '\' is used to escape glob charater
  // as mentioned in the documentation of node-glob

  // the path is normalised and '\' are replaced with '/' and then passed to the glob function
  let normalizedGlob = getAppFilesPathPattern(config.rootUri);

  const paths = await glob(normalizedGlob, { absolute: true }).then((result) =>
    // Global ignored paths should not be part of the app
    result.filter((filePath) => !isIgnored(filePath, config)),
  );
  const sourceCodes = await Promise.all(paths.map(toSourceCode));
  return sourceCodes.filter(
    (x): x is LiquidSourceCode | JSONSourceCode | GraphQLSourceCode | YAMLSourceCode =>
      x !== undefined,
  );
}

export function getAppFilesPathPattern(rootUri: string) {
  return path
    .normalize(path.join(fileURLToPath(rootUri), '**/*.{liquid,json,graphql,yml,yaml}'))
    .replace(/\\/g, '/');
}

/** @deprecated Use appCheckRun instead */
export const runCheck = appCheckRun;
/** @deprecated Use appCheckRun instead */
export const themeCheckRun = appCheckRun;
