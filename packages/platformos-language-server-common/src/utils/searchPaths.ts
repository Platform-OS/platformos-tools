import { AbstractFileSystem, loadSearchPaths } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

/**
 * Loader for theme_search_paths from app/config.yml.
 * Always reads fresh — config.yml bypasses the CachedFileSystem cache
 * so that external edits (e.g. vim, CLI) are picked up without relying
 * on file watcher notifications.
 */
export class SearchPathsLoader {
  constructor(private fs: AbstractFileSystem) {}

  get(rootUri: URI): Promise<string[] | null> {
    return loadSearchPaths(this.fs, rootUri);
  }
}
