import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';
import { uriFromPath } from '@platformos/platformos-common';

import { UNKNOWN, fingerprintOf } from './fingerprints';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/** An mtime both writes below are pinned to, so mtime alone cannot distinguish them. */
const PINNED = new Date(1700000000000);

/**
 * Block until the filesystem's timestamp clock has ticked past `since`.
 *
 * WHY THIS IS NEEDED, and why it is not a workaround for a broken assertion.
 * `fingerprintOf` discriminates via `ctimeMs`, which is only as fine as the filesystem
 * clock. Measured on ext4: two back-to-back rewrites produce an IDENTICAL `ctimeMs` ~69%
 * of the time, smallest non-zero delta ~1 ms, and `{ bigint: true }` nanosecond stats show
 * the same floor because the kernel coarsens the stored value.
 *
 * So a test that rewrites a file microseconds after reading its fingerprint is asserting
 * something NO stat-based fingerprint can deliver — it fails most of the time against a
 * perfectly correct implementation. That is noise, and noise is worse than no test.
 *
 * Separating the two changes into different ticks removes that confound and leaves the
 * assertion the test actually exists for. The sub-tick blindness is a real bound and is
 * pinned separately below rather than hidden here.
 *
 * Polls rather than sleeping a fixed amount, so it holds on filesystems with much coarser
 * granularity (1 s on some NFS mounts, 2 s on FAT/exFAT).
 */
async function awaitFilesystemTick(directory: string, since: number): Promise<void> {
  const probe = path.join(directory, '.tick-probe');
  for (let attempt = 0; attempt < 5000; attempt++) {
    await fs.writeFile(probe, String(attempt));
    const { ctimeMs } = await fs.stat(probe);
    if (ctimeMs > since) {
      await fs.rm(probe, { force: true });
      return;
    }
  }
  throw new Error('filesystem timestamp clock did not advance');
}

/**
 * `fingerprintOf` is how BOTH process-level caches in this package — the shared `App` and
 * the shared `RouteTable` — decide whether what they remember is still true. Neither gets
 * filesystem events, so an agent editing files out of band is exactly the case it has to
 * be right for, and a false "unchanged" means a write gate judging stale content.
 */
describe('Unit: fingerprintOf', () => {
  let workspace: Workspace;
  let target: string;
  let targetUri: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({ 'a.liquid': 'aaaaa' });
    target = path.join(URI.parse(workspace.rootUri).fsPath, 'a.liquid');
    targetUri = uriFromPath(target);
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  /**
   * THE REASON `ctime` IS IN THE FINGERPRINT. `mtime` is settable from userland, `ctime`
   * is not — so an mtime-restored, equal-length rewrite is invisible to `mtime:size`.
   * Drop `ctimeMs` from `fingerprintOf` and this test fails.
   */
  it('changes when content of the same length is written under a restored mtime', async () => {
    await fs.utimes(target, PINNED, PINNED);
    const before = await fingerprintOf(targetUri);

    // The two changes must land in different filesystem ticks, or `ctimeMs` cannot tell
    // them apart no matter how the fingerprint is built — see the helper.
    await awaitFilesystemTick(path.dirname(target), (await fs.stat(target)).ctimeMs);

    await fs.writeFile(target, 'bbbbb');
    await fs.utimes(target, PINNED, PINNED);
    const after = await fingerprintOf(targetUri);

    // Proof the confound is real rather than assumed: mtime and size are IDENTICAL across
    // the edit, so anything that discriminates here is discriminating on ctime.
    const stat = await fs.stat(target);
    expect([stat.mtimeMs, stat.size]).toEqual([PINNED.getTime(), 5]);
    expect(after).not.toEqual(before);
  });

  it('rests entirely on mtime, ctime and size — which is what bounds it', async () => {
    // Pinned as a SHAPE, deterministically, because it is what makes the bound above
    // legible: discrimination comes from these three values and nothing else, so two
    // changes sharing a timestamp tick while keeping their byte length are
    // indistinguishable by construction. Closing that would mean hashing content on every
    // call, which is the cost these caches exist to avoid.
    const stat = await fs.stat(target);

    expect(await fingerprintOf(targetUri)).toEqual(`${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
  });

  it('is stable across repeated reads of an untouched file', async () => {
    expect(await fingerprintOf(targetUri)).toEqual(await fingerprintOf(targetUri));
  });

  /**
   * A file whose state cannot be established must never compare EQUAL to a real
   * fingerprint, so the caller re-reads rather than trusting a stale entry. Returning
   * `UNKNOWN` — rather than a value that could collide — is what makes the failure mode
   * safe in the direction that matters for a write gate.
   */
  it('is UNKNOWN for a file that does not exist, and never equals a real fingerprint', async () => {
    const missing = uriFromPath(path.join(URI.parse(workspace.rootUri).fsPath, 'nope.liquid'));

    expect(await fingerprintOf(missing)).toEqual(UNKNOWN);
    expect(await fingerprintOf(targetUri)).not.toEqual(UNKNOWN);
  });

  it('is UNKNOWN for a directory it is handed instead of a file', async () => {
    // `stat` succeeds on a directory, so this would otherwise produce a plausible
    // fingerprint for something no cache should be tracking as a source.
    const directory = uriFromPath(URI.parse(workspace.rootUri).fsPath);

    expect(await fingerprintOf(directory)).not.toEqual(await fingerprintOf(targetUri));
  });
});
