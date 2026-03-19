import { AbstractFileSystem, loadSearchPaths } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

/**
 * Cached loader for theme_search_paths from app/config.yml.
 *
 * Caches per root URI so that repeated calls (document links, definitions,
 * checks) within the same editor session don't re-read and re-parse the
 * config file on every invocation.
 *
 * Call `invalidate()` when app/config.yml changes on disk — the file watcher
 * in startServer.ts handles this. This is the only reliable invalidation
 * point because config.yml changes may come from external tools (vim, CLI)
 * that don't trigger editor-level change events.
 */
export class SearchPathsLoader {
  private cache = new Map<string, Promise<string[] | null>>();

  constructor(private fs: AbstractFileSystem) {}

  get(rootUri: URI): Promise<string[] | null> {
    const key = rootUri.toString();
    if (!this.cache.has(key)) {
      this.cache.set(key, loadSearchPaths(this.fs, rootUri));
    }
    return this.cache.get(key)!;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
