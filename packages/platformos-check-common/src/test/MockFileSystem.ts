import { AbstractFileSystem, FileStat, FileTuple, FileType } from '@platformos/platformos-common';
import { deepGet } from '../utils';
import { normalize, relative } from '../path';
import { MockApp } from './MockApp';
import * as path from '../path';

interface FileTree {
  [fileName: string]: string | FileTree;
}

export class MockFileSystem implements AbstractFileSystem {
  private rootUri: string;

  constructor(
    private mockApp: MockApp,
    rootUri = 'file:///',
  ) {
    this.rootUri = normalize(rootUri);
  }

  async readFile(uri: string): Promise<string> {
    const relativePath = this.rootRelative(uri);
    if (this.mockApp[relativePath] === undefined) {
      throw new Error('File not found');
    } else {
      return this.mockApp[relativePath];
    }
  }

  async readDirectory(uri: string): Promise<FileTuple[]> {
    // eslint-disable-next-line no-param-reassign
    uri = uri.replace(/\/$/, '');
    const relativePath = this.rootRelative(uri);
    const tree =
      path.normalize(uri) === this.rootUri
        ? this.fileTree
        : deepGet(this.fileTree, relativePath.split('/'));
    if (tree === undefined || tree === null) {
      throw new Error(`Directory not found: ${uri} for ${this.rootUri}`);
    }

    if (typeof tree === 'string') {
      return [[uri, FileType.File]];
    }

    return Object.entries(tree).map(([fileName, value]) => {
      return [`${uri}/${fileName}`, typeof value === 'string' ? FileType.File : FileType.Directory];
    });
  }

  async stat(uri: string): Promise<FileStat> {
    const relativePath = this.rootRelative(uri);
    const source = this.mockApp[relativePath];
    if (source) {
      return {
        type: FileType.File,
        size: source.length ?? 0,
      };
    }

    const readdirResult = await this.readDirectory(uri);
    if (readdirResult) {
      return {
        type: FileType.Directory,
        size: 0, // Size is not applicable for directories
      };
    }

    throw new Error(`File not found: ${uri} for ${this.rootUri}`);
  }

  private get fileTree(): FileTree {
    const result: FileTree = {};
    for (const [relativePath, source] of Object.entries(this.mockApp)) {
      const segments = relativePath.split('/');
      let current = result;
      for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        current[segment] ??= {};
        current = current[segment] as FileTree;
      }
      current[segments[segments.length - 1]] = source;
    }
    return result;
  }

  private rootRelative(uri: string) {
    return relative(normalize(uri), this.rootUri);
  }
}
