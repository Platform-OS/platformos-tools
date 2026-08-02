import { UriString } from '@platformos/platformos-common';

import { NodeFileSystem } from './NodeFileSystem';

/**
 * What a file looked like at the moment something read it.
 *
 * Two process-level caches in this package — the shared `App` and the shared
 * `RouteTable` — outlive the call that filled them, and neither gets filesystem
 * events: an agent editing files out of band is exactly the case they have to be
 * correct for. Both answer "is what I remember still true" the same way, by
 * comparing `mtime`/`size` against what they recorded, so the comparison lives
 * here rather than in each of them. Two spellings of it would have to stay
 * bit-identical — they compare against the same {@link UNKNOWN} sentinel — while
 * being free to drift.
 */

/**
 * Recorded for a file whose state cannot be established — an unsaved buffer, a
 * filesystem that reports no modification time, a file that vanished. It never
 * equals a real fingerprint, so such a file is re-read on the next run rather
 * than trusted.
 */
export const UNKNOWN = 'unknown';

/** `mtime:size` for the file at `uri`, or {@link UNKNOWN}. */
export async function fingerprintOf(uri: UriString): Promise<string> {
  try {
    const stat = await NodeFileSystem.stat(uri);
    return stat.mtimeMs === undefined ? UNKNOWN : `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return UNKNOWN;
  }
}
