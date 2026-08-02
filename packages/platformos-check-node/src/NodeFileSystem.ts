import { path } from '@platformos/platformos-check-common';
import { FileStat, AbstractFileSystem, FileTuple, FileType } from '@platformos/platformos-common';

import fs from 'node:fs/promises';

export const NodeFileSystem: AbstractFileSystem = {
  async readFile(uri: string): Promise<string> {
    // I'm intentionally leaving these comments here for debugging purposes :)
    // console.error('fs/readFile', uri);
    return fs.readFile(path.fsPath(uri), 'utf8');
  },

  async readDirectory(uri: string): Promise<FileTuple[]> {
    // console.error('fs/readDirectory', uri);
    const files = await fs.readdir(path.fsPath(uri), { withFileTypes: true });
    // `childUri`, not `join`: this runs once per entry of every directory a walk
    // opens — ~30 000 times on a real project, for entries the caller mostly throws
    // away — and `join`'s parse/serialize round trip was a third of the walk.
    return files.map((file) => {
      return [
        path.childUri(uri, file.name),
        file.isDirectory() ? FileType.Directory : FileType.File,
      ];
    });
  },

  async stat(uri: string): Promise<FileStat> {
    // console.error('fs/stat', uri);
    try {
      const stats = await fs.stat(path.fsPath(uri));
      return {
        type: stats.isDirectory() ? FileType.Directory : FileType.File,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    } catch (e) {
      throw new Error(`Failed to get file stat: ${e}`);
    }
  },
};
