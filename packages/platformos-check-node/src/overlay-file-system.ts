import { path as pathUtils, type UriString } from '@platformos/platformos-check-common';
import {
  FileType,
  type AbstractFileSystem,
  type FileStat,
  type FileTuple,
} from '@platformos/platformos-common';

/**
 * An {@link AbstractFileSystem} that presents in-memory buffers as if they were on
 * disk, falling through to `base` for everything else.
 *
 * WHY THIS IS NEEDED. Overlaying a buffer into the `App` is NOT enough to make
 * cross-file checks see it. `MissingPartial` (and the other reference checks)
 * resolve names through `DocumentsLocator`, which asks `context.fs.stat` whether a
 * candidate path exists — the real filesystem. So a partial that exists only as an
 * unsaved buffer is reported missing no matter how the `App` is assembled.
 *
 * That is exactly the false positive a batch has to remove: an agent creating
 * `promo.liquid` and a page that renders it, in one edit, would otherwise be told
 * `'promo' does not exist` about a file sitting in the very same request. The `App`
 * overlay makes the buffer's CONTENT authoritative; this makes its EXISTENCE
 * authoritative. Both are required.
 *
 * Deliberately narrow: it adds and shadows files, never hides them. A buffer for a
 * path that also exists on disk shadows the disk copy (the unsaved edit is what is
 * being validated); a path with no buffer behaves exactly as before.
 */
export function overlayFileSystem(
  base: AbstractFileSystem,
  overlays: ReadonlyMap<UriString, string>,
): AbstractFileSystem {
  if (overlays.size === 0) return base;

  // Normalize once: callers key by normalized URI, and lookups arrive from
  // `DocumentsLocator`'s path joining, which may differ in separators or casing of
  // the scheme. Comparing normalized forms keeps the two in agreement.
  const byUri = new Map<UriString, string>();
  for (const [uri, content] of overlays) byUri.set(pathUtils.normalize(uri), content);

  const lookup = (uri: UriString) => byUri.get(pathUtils.normalize(uri));

  return {
    async readFile(uri: string): Promise<string> {
      const buffered = lookup(uri);
      return buffered ?? base.readFile(uri);
    },

    async stat(uri: string): Promise<FileStat> {
      const buffered = lookup(uri);
      if (buffered === undefined) return base.stat(uri);
      return { type: FileType.File, size: Buffer.byteLength(buffered, 'utf8') };
    },

    async readDirectory(uri: string): Promise<FileTuple[]> {
      // Start from disk, tolerating a directory that does not exist yet — a batch
      // may create the first file in a brand-new directory, and listing it must
      // then yield that file rather than throwing.
      const onDisk = await base.readDirectory(uri).catch((): FileTuple[] => []);
      const seen = new Set(onDisk.map(([entryUri]) => pathUtils.normalize(entryUri)));

      const directory = pathUtils.normalize(uri);
      const extra: FileTuple[] = [];
      for (const bufferedUri of byUri.keys()) {
        if (seen.has(bufferedUri)) continue;
        // Direct children only: a listing must not surface files from nested
        // directories as if they sat here.
        if (pathUtils.normalize(pathUtils.dirname(bufferedUri)) !== directory) continue;
        extra.push([bufferedUri, FileType.File]);
      }

      return extra.length === 0 ? onDisk : [...onDisk, ...extra];
    },
  };
}
