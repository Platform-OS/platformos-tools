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
}

/** A vscode-uri string */
export type UriString = string;

export type FileTuple = [uri: UriString, fileType: FileType];
