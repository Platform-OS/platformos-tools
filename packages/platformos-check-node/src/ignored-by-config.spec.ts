import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { ignoredByConfig, lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * `check()` skips config-ignored files SILENTLY, so a caller that lints one buffer
 * and sees no offenses cannot tell "clean" from "never checked". For the MCP
 * supervisor that difference is the whole contract: an ignored file containing
 * unparseable Liquid was reported `status: ok, must_fix_before_write: false` — the
 * write gate approving a file nothing had looked at.
 *
 * `ignoredByConfig` is what lets a caller tell the two apart.
 */
describe('Integration: ignoredByConfig', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  const absolute = (relativePath: string) => path.join(root, ...relativePath.split('/'));

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingContentForLayout:',
        '  enabled: true',
        'ignore:',
        '  - app/views/pages/**',
        '  - modules/vendored/**',
        '',
      ].join('\n'),
      app: {
        views: {
          pages: { 'ignored.liquid': '<div></div>' },
          partials: { 'kept.liquid': '<div></div>' },
          layouts: { 'theme.liquid': '<html>{{ content_for_layout }}</html>' },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('reports an ignored path', async () => {
    const target = absolute('app/views/pages/ignored.liquid');

    expect(await ignoredByConfig(root, [target], configPath)).toEqual(new Set([target]));
  });

  it('reports nothing for a kept path', async () => {
    expect(
      await ignoredByConfig(root, [absolute('app/views/partials/kept.liquid')], configPath),
    ).toEqual(new Set());
  });

  it('partitions a mixed list, returning the caller’s own strings', async () => {
    const ignored = absolute('app/views/pages/ignored.liquid');
    const kept = absolute('app/views/partials/kept.liquid');
    const alsoIgnored = absolute('modules/vendored/thing.liquid');

    expect(await ignoredByConfig(root, [ignored, kept, alsoIgnored], configPath)).toEqual(
      new Set([ignored, alsoIgnored]),
    );
  });

  it('reports a path that does not exist on disk but matches the pattern', async () => {
    // The supervisor validates UNSAVED buffers, so the file frequently is not on
    // disk yet. Ignore status must be decided from the pattern, not from existence.
    const target = absolute('app/views/pages/not-created-yet.liquid');

    expect(await ignoredByConfig(root, [target], configPath)).toEqual(new Set([target]));
  });

  it('returns an empty set for an empty list without loading the config', async () => {
    expect(await ignoredByConfig(root, [], configPath)).toEqual(new Set());
  });

  it('ignores only the GLOBAL list, not a per-check ignore', async () => {
    // A per-check `ignore` means the file is still checked, just by fewer checks.
    // Treating that as "not checked" would be wrong in the other direction.
    const perCheckOnly = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingContentForLayout:',
        '  enabled: true',
        '  ignore:',
        '    - app/views/layouts/**',
        '',
      ].join('\n'),
      app: { views: { layouts: { 'theme.liquid': '<html></html>' } } },
    });
    try {
      const otherRoot = URI.parse(perCheckOnly.rootUri).fsPath;
      const target = path.join(otherRoot, 'app/views/layouts/theme.liquid');

      expect(
        await ignoredByConfig(otherRoot, [target], path.join(otherRoot, '.platformos-check.yml')),
      ).toEqual(new Set());
    } finally {
      await perCheckOnly.clean();
    }
  });

  it('agrees with what the lint actually does: an ignored file yields no offenses', async () => {
    // The load-bearing correlation. If these two ever disagree, the supervisor
    // either reports a false pass or refuses a file it could have checked.
    const ignoredLayout = absolute('app/views/pages/ignored.liquid');

    const offenses = await lintBuffer({
      root,
      configPath,
      filePath: ignoredLayout,
      // Deliberately unparseable: a real check would have plenty to say.
      content: '{% if %}{{ unclosed',
    });

    expect(offenses).toEqual([]);
    expect(await ignoredByConfig(root, [ignoredLayout], configPath)).toEqual(
      new Set([ignoredLayout]),
    );
  });

  it('and a KEPT file with the same broken content does produce offenses', async () => {
    // Proves the test above is not vacuous — the emptiness came from the ignore
    // list, not from the checks having nothing to say.
    const keptLayout = absolute('app/views/layouts/theme.liquid');

    const offenses = await lintBuffer({
      root,
      configPath,
      filePath: keptLayout,
      content: '<html><body></body></html>',
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['MissingContentForLayout']);
    expect(await ignoredByConfig(root, [keptLayout], configPath)).toEqual(new Set());
  });
});
