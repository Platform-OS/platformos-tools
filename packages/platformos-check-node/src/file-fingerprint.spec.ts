import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { AppCache, fileFingerprint, lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/** An mtime both writes below are pinned to, so mtime alone cannot distinguish them. */
const PINNED = new Date(1700000000000);

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

    // Same byte length, and mtime forced back to the original: `mtimeMs:size`
    // alone would be identical here, which is the stale-cache hole.
    await fs.writeFile(target, 'bbbbb');
    await fs.utimes(target, PINNED, PINNED);
    const after = await fileFingerprint(target);

    const stat = await fs.stat(target);
    expect([stat.mtimeMs, stat.size]).toEqual([PINNED.getTime(), 5]);
    expect(after).not.toEqual(before);
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
