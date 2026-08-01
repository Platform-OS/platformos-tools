import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { AppCache, fileFingerprint, lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/** An mtime both writes below are pinned to, so mtime alone cannot distinguish them. */
const PINNED = new Date(1700000000000);

/**
 * Block until the filesystem's timestamp clock has ticked past `since`.
 *
 * WHY THIS IS NEEDED, and why it is not a workaround for a broken assertion.
 * `fileFingerprint` discriminates via `ctimeMs`, which is only as fine as the
 * filesystem clock. Measured on ext4: two back-to-back rewrites produce an IDENTICAL
 * `ctimeMs` ~69% of the time, smallest non-zero delta ~1 ms, and `{ bigint: true }`
 * nanosecond stats show the same floor because the kernel coarsens the stored value.
 *
 * So a test that rewrites a file microseconds after reading its fingerprint is
 * asserting something NO stat-based fingerprint can deliver — it fails most of the
 * time against a perfectly correct implementation. That is noise, and noise is worse
 * than no test: this one was written off as "a known flake" for exactly that reason.
 *
 * Separating the two changes into different ticks removes that confound and leaves
 * the assertion the test actually exists for: drop `ctimeMs` from the fingerprint and
 * an mtime-restored, equal-length edit becomes invisible. That regression still fails
 * this test. The sub-tick blindness is a real bound and is pinned separately below,
 * rather than hidden here.
 *
 * Polls rather than sleeping a fixed amount, so it holds on filesystems with much
 * coarser granularity (1 s on some NFS mounts, 2 s on FAT/exFAT).
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

describe('Unit: fileFingerprint', () => {
  let workspace: Workspace;
  let target: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({ 'a.liquid': 'aaaaa' });
    target = path.join(URI.parse(workspace.rootUri).fsPath, 'a.liquid');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('changes when content of the same length is written under a restored mtime', async () => {
    await fs.utimes(target, PINNED, PINNED);
    const before = await fileFingerprint(target);

    // The two changes must land in different filesystem ticks, or `ctimeMs` cannot
    // tell them apart no matter how the fingerprint is built — see the helper.
    await awaitFilesystemTick(path.dirname(target), (await fs.stat(target)).ctimeMs);

    // Same byte length, and mtime forced back to the original: `mtimeMs:size`
    // alone would be identical here, which is the stale-cache hole.
    await fs.writeFile(target, 'bbbbb');
    await fs.utimes(target, PINNED, PINNED);
    const after = await fileFingerprint(target);

    const stat = await fs.stat(target);
    expect([stat.mtimeMs, stat.size]).toEqual([PINNED.getTime(), 5]);
    expect(after).not.toEqual(before);
  });

  it('rests entirely on mtime, ctime and size — which is what bounds it', async () => {
    // Pinned as a SHAPE, deterministically, because it is what makes the bound above
    // legible: discrimination comes from these three values and nothing else, so two
    // changes sharing a timestamp tick while keeping their byte length are
    // indistinguishable by construction. Closing that would mean reading file content
    // on every call, which is the cost `AppCache` exists to avoid.
    const stat = await fs.stat(target);

    expect(await fileFingerprint(target)).toEqual(`${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
  });

  it('is stable across repeated reads of an untouched file', async () => {
    expect(await fileFingerprint(target)).toEqual(await fileFingerprint(target));
  });

  it('is undefined for a file that does not exist', async () => {
    expect(await fileFingerprint(path.join(target, '..', 'ghost.liquid'))).toBeUndefined();
  });
});

/**
 * The regression this guards: an equal-length `{% doc %}` edit under a restored
 * mtime used to leave `AppCache` serving the previous parse, so `getDocDefinition`
 * reported the OLD `@param` list and a corrected call site was flagged
 * `Unknown parameter`.
 */
describe('Integration: AppCache invalidation for a forged mtime', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;
  let page: string;
  let partial: string;

  const docDeclaring = (param: string) =>
    `{% doc %}\n  @param ${param} {string} A param\n{% enddoc %}\n{{ ${param} }}\n`;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'PartialCallArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          // The call site passes `other`.
          pages: { 'index.liquid': `{% render 'card', other: 1 %}` },
          // `title` and `other` are both 5 characters, so the two doc versions
          // below are byte-identical in length.
          partials: { 'card.liquid': docDeclaring('title') },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
    page = path.join(root, 'app/views/pages/index.liquid');
    partial = path.join(root, 'app/views/partials/card.liquid');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  const lintPage = async (cache?: AppCache) => {
    const offenses = await lintBuffer({
      root,
      filePath: page,
      content: await fs.readFile(page, 'utf8'),
      configPath,
      cache,
    });
    return offenses.map((offense) => offense.message);
  };

  it('re-reads a partial whose doc changed under a restored mtime and equal size', async () => {
    const cache = new AppCache();
    await fs.utimes(partial, PINNED, PINNED);

    expect(await lintPage(cache)).toEqual([
      'Unknown parameter other passed to render call',
      'Required parameter title must be passed to render call',
    ]);

    // Same tick separation as the unit test. The lint above happens to take far
    // longer than one tick, so this passes without it today — but that is luck, not
    // a property, and it is exactly the confound that made the unit test look flaky.
    await awaitFilesystemTick(path.dirname(partial), (await fs.stat(partial)).ctimeMs);

    // The doc now declares exactly what the call site passes, so the correct
    // answer is "no offenses" — reported only if the stale parse is not reused.
    await fs.writeFile(partial, docDeclaring('other'));
    await fs.utimes(partial, PINNED, PINNED);
    const stat = await fs.stat(partial);
    expect(stat.mtimeMs).toEqual(PINNED.getTime());

    expect(await lintPage(cache)).toEqual([]);
  });

  it('agrees with an uncached run in that scenario', async () => {
    await fs.utimes(partial, PINNED, PINNED);
    await fs.writeFile(partial, docDeclaring('other'));
    await fs.utimes(partial, PINNED, PINNED);

    expect(await lintPage(new AppCache())).toEqual(await lintPage(undefined));
  });
});
