import { ThemeLiquidDocsManager } from '@platformos/platformos-check-docs-updater';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { startServer as startCoreServer } from '@platformos/platformos-language-server-common';
import { stdin, stdout } from 'node:process';
import { createConnection } from 'vscode-languageserver/node';
import { loadConfig } from './dependencies';
import { fetchMetafieldDefinitionsForURI } from './metafieldDefinitions';
import { log, logInfo, logError, closeLog, getLogFilePath } from './logger';

export { NodeFileSystem } from '@platformos/platformos-check-node';
export * from '@platformos/platformos-language-server-common';
export { log, logInfo, logError, closeLog, getLogFilePath };

export const getConnection = () => createConnection(stdin, stdout);

export function startServer(connection = getConnection(), fs: AbstractFileSystem = NodeFileSystem) {
  logInfo(`Language server starting, logs: ${getLogFilePath()}`);
  const themeLiquidDocsManager = new ThemeLiquidDocsManager(log);

  startCoreServer(connection, {
    fs,
    log,
    loadConfig,
    themeDocset: themeLiquidDocsManager,
    jsonValidationSet: themeLiquidDocsManager,
    fetchMetafieldDefinitionsForURI,
  });

  process.on('exit', () => {
    logInfo('Language server exiting');
    closeLog();
  });

  process.on('uncaughtException', (error) => {
    logError('Uncaught exception', error);
  });

  process.on('unhandledRejection', (reason) => {
    logError('Unhandled rejection', reason);
  });
}

if (require.main === module) {
  startServer();
}
