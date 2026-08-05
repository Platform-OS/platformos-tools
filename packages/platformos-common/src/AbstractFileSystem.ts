/**
 * The AbstractFileSystem interface is used to abstract file system operations.
 *
 * This way, the App Check library can be used in different environments,
 * such as the browser, node.js or VS Code (which works with local files, remote
 * files and on the web)
 */
export interface AbstractFileSystem {
  stat(uri: string): Promise<FileStat>;
  readFile(uri: string): Promise<string>;
  readDirectory(uri: string): Promise<FileTuple[]>;
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface FileStat {
  type: FileType;
  size: number;
  /**
   * Last-modification time in milliseconds, for filesystems that have one.
   *
   * `undefined` means the filesystem cannot say — an in-memory or virtual one —
   * which callers must read as "cannot tell whether this changed", not as
   * "unchanged".
   */
  mtimeMs?: number;
  /**
   * Inode-change time in milliseconds, for filesystems that have one.
   *
   * Distinct from {@link mtimeMs} in the one way that matters to a cache: `mtime` is
   * settable from userland (`utimes`) and this is not — any write moves it and nothing
   * can put it back. A tool that restores an mtime after writing, or a same-length
   * replacement, is therefore invisible to `mtime`/`size` alone. See check-node's
   * `fingerprintOf`, which is the only consumer.
   *
   * OPTIONAL, and no implementation is obliged to answer: a virtual or in-memory
   * filesystem has no such concept, and the consumer degrades to `mtime`/`size` rather
   * than demanding it. `undefined` therefore means "cannot say", never "unchanged".
   */
  ctimeMs?: number;
}

/** A vscode-uri string */
export type UriString = string;

export type FileTuple = [uri: UriString, fileType: FileType];
