import type { AbstractFileSystem } from '@platformos/platformos-common';
import { getConnection, NodeFileSystem, startServer } from '@platformos/platformos-language-server-node';
import { VsCodeFileSystem } from '../common/VsCodeFileSystem';

const connection = getConnection();

// When the URI starts with `file://`, we can use the NodeFileSystem directly (it's faster)
const fileSystems: Record<string, AbstractFileSystem> = {
  file: NodeFileSystem,
};

startServer(connection, new VsCodeFileSystem(connection, fileSystems));

process.on('uncaughtException', (e) => {
  console.error(e);
});

process.on('unhandledRejection', (e) => {
  console.error(e);
});
