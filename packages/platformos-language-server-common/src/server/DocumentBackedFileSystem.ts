import { AbstractFileSystem, FileStat, FileTuple } from '@platformos/platformos-common';
import { DocumentManager } from '../documents';

/**
 * A filesystem layer that serves the content of tracked documents from the
 * DocumentManager and delegates everything else to the underlying filesystem.
 *
 * Checks read the files they reference (e.g. the partial targeted by a
 * `render`/`function` call) through `context.fs.readFile`. Without this layer
 * those reads hit the disk-backed CachedFileSystem, which returns the last saved
 * — and cached — version of the file. As a result, an edit to a partial did not
 * update cross-file diagnostics on the *calling* file until the partial was saved
 * and its cache entry invalidated.
 *
 * The DocumentManager always holds the latest in-editor buffer for open documents
 * (and the latest disk content for preloaded ones), so preferring it keeps
 * cross-file checks in sync with what the user is actually editing.
 */
export class DocumentBackedFileSystem implements AbstractFileSystem {
  constructor(
    private readonly fs: AbstractFileSystem,
    private readonly documentManager: DocumentManager,
  ) {}

  async readFile(uri: string): Promise<string> {
    const document = this.documentManager.get(uri);
    if (document) {
      return document.source;
    }
    return this.fs.readFile(uri);
  }

  readDirectory(uri: string): Promise<FileTuple[]> {
    return this.fs.readDirectory(uri);
  }

  stat(uri: string): Promise<FileStat> {
    return this.fs.stat(uri);
  }
}
