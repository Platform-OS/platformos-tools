import { PlatformOSLiquidDocsManager } from '@platformos/platformos-check-docs-updater';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { startServer as startCoreServer } from '@platformos/platformos-language-server-common';
import { stdin, stdout } from 'node:process';
import { createConnection } from 'vscode-languageserver/node';
import { loadConfig } from './dependencies';

export { NodeFileSystem } from '@platformos/platformos-check-node';
export * from '@platformos/platformos-language-server-common';

export const getConnection = () => createConnection(stdin, stdout);

export function startServer(connection = getConnection(), fs: AbstractFileSystem = NodeFileSystem) {
  // Using console.error to not interfere with messages sent on STDIN/OUT
  const log = (message: string) => console.error(message);
  const themeLiquidDocsManager = new PlatformOSLiquidDocsManager(log);

  startCoreServer(connection, {
    fs,
    log,
    loadConfig,
    platformosDocset: themeLiquidDocsManager,
    jsonValidationSet: themeLiquidDocsManager,
  });
}
