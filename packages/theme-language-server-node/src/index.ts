import { ThemeLiquidDocsManager } from '@platformos/theme-check-docs-updater';
import { AbstractFileSystem, NodeFileSystem } from '@platformos/theme-check-node';
import { startServer as startCoreServer } from '@platformos/theme-language-server-common';
import { stdin, stdout } from 'node:process';
import { createConnection } from 'vscode-languageserver/node';
import { loadConfig } from './dependencies';
import { fetchMetafieldDefinitionsForURI } from './metafieldDefinitions';

export { NodeFileSystem } from '@platformos/theme-check-node';
export * from '@platformos/theme-language-server-common';

export const getConnection = () => createConnection(stdin, stdout);

export function startServer(connection = getConnection(), fs: AbstractFileSystem = NodeFileSystem) {
  // Using console.error to not interfere with messages sent on STDIN/OUT
  const log = (message: string) => console.error(message);
  const themeLiquidDocsManager = new ThemeLiquidDocsManager(log);

  startCoreServer(connection, {
    fs,
    log,
    loadConfig,
    themeDocset: themeLiquidDocsManager,
    jsonValidationSet: themeLiquidDocsManager,
    fetchMetafieldDefinitionsForURI,
  });
}
