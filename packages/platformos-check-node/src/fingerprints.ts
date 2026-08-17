import { UriString } from '@platformos/platformos-common';

import { NodeFileSystem } from './NodeFileSystem';

/**
 * What a file looked like at the moment something read it.
 *
 * Two process-level caches in this package — the shared `App` and the shared `RouteTable` —
 * outlive the call that filled them and get no filesystem events, so both answer "is what I
 * remember still true" by comparing what they recorded against a fresh `stat`. The comparison
 * lives here rather than in each of them, since two spellings would have to stay bit-identical
 * while being free to drift.
 */

/**
 * Recorded for a file whose state cannot be established — an unsaved buffer, a
 * filesystem that reports no modification time, a file that vanished. It never
 * equals a real fingerprint, so such a file is re-read on the next run rather
 * than trusted.
 */
export const UNKNOWN = 'unknown';

/**
 * `mtime:ctime:size` for the file at `uri`, or {@link UNKNOWN}.
 *
 * WHY `ctime` IS IN HERE. `mtime` is settable from userland (`utimes`), `ctime` is not: any
 * write moves it and nothing can put it back. A tool that restores an mtime after writing — and
 * a same-length replacement — is therefore INVISIBLE to `mtime:size`, which is a stale cache
 * serving old content to a write gate. `fingerprints.spec.ts` writes five bytes over five with
 * the mtime pinned back.
 *
 * Read through `NodeFileSystem.stat`, NOT `node:fs` directly: that is the seam the shared app's
 * revalidation is observed at, and going straight to `node:fs` silently unhooks that test.
 *
 * `ctimeMs` is OPTIONAL on `FileStat`, so a filesystem that cannot answer it degrades to
 * `mtime:size`.
 *
 * What still cannot be discriminated: two changes landing in the same filesystem tick while
 * keeping the byte length. Closing that means hashing content on every call.
 */
/**
 * Whether {@link fingerprintOf} could establish the file's state at all.
 *
 * THE EXPORTED FORM OF THE {@link UNKNOWN} CHECK, and the sentinel itself deliberately
 * stays in this module. An outside caller only ever needs the QUESTION — "did that
 * succeed?" — while the VALUE carries a footgun: `UNKNOWN === UNKNOWN`, so a cache that
 * stores it for a file it could not read finds the same value on the next scan and
 * concludes the file is unchanged, permanently. Handing out the predicate instead of the
 * constant removes the shape of that mistake from every consumer that is not in this
 * package. The two callers here store it as well as compare it, so they use the constant.
 */
export function isKnownFingerprint(fingerprint: string): boolean {
  return fingerprint !== UNKNOWN;
}

export async function fingerprintOf(uri: UriString): Promise<string> {
  try {
    const stat = await NodeFileSystem.stat(uri);
    if (stat.mtimeMs === undefined) return UNKNOWN;
    return stat.ctimeMs === undefined
      ? `${stat.mtimeMs}:${stat.size}`
      : `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    return UNKNOWN;
  }
}
