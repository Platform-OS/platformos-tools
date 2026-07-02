import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { AppCache, getApp, lintBuffer, loadConfig, type App, type Config } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * TASK-9.13: the opt-in `AppCache` lets `getApp`/`lintBuffer` reuse parsed
 * project sources across calls (the whole-project parse is the dominant cost),
 * while NEVER serving a stale parse — reuse is gated on a per-file fingerprint.
 *
 * "Not re-parsed" is asserted by OBJECT IDENTITY: a reused file is the SAME
 * `SourceCode` instance across calls; a re-parsed file is a new instance.
 */
describe('Unit: AppCache (parsed-project reuse for getApp/lintBuffer)', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;
  let config: Config;

  const abs = (rel: string) => path.join(root, ...rel.split('/'));
  const byUri = (app: App) => new Map(app.map((file) => [file.uri, file]));

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': ['extends: platformos-check:nothing', ''].join('\n'),
      app: {
        views: {
          partials: {
            'a.liquid': '<div>a</div>',
            'b.liquid': '<div>b</div>',
          },
          pages: {
            'home.liquid': '<h1>home</h1>',
          },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
    config = await loadConfig(configPath, root);
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('reuses the SAME parsed instances across calls when nothing changed (no re-parse)', async () => {
    const cache = new AppCache();
    const first = byUri(await getApp(config, cache));
    const second = byUri(await getApp(config, cache));

    expect(first.size).toBe(3);
    expect(cache.size).toBe(3);
    for (const [uri, source] of first) {
      expect(second.get(uri)).toBe(source); // identical instance ⇒ not re-parsed
    }
  });

  it('re-parses only the changed file and reuses the rest (never stale)', async () => {
    const cache = new AppCache();
    const first = byUri(await getApp(config, cache));

    // Different-length content guarantees the fingerprint moves regardless of mtime resolution.
    await fs.writeFile(abs('app/views/partials/a.liquid'), '<div>a — edited longer</div>', 'utf8');
    const after = byUri(await getApp(config, cache));

    const aUri = workspace.uri('app/views/partials/a.liquid');
    const bUri = workspace.uri('app/views/partials/b.liquid');
    const homeUri = workspace.uri('app/views/pages/home.liquid');

    expect(after.get(aUri)).not.toBe(first.get(aUri)); // changed ⇒ re-parsed (new instance)
    expect(after.get(aUri)!.source).toContain('edited longer'); // reflects new content
    expect(after.get(bUri)).toBe(first.get(bUri)); // unchanged ⇒ reused
    expect(after.get(homeUri)).toBe(first.get(homeUri)); // unchanged ⇒ reused
  });

  it('picks up an added file and reuses the rest', async () => {
    const cache = new AppCache();
    const first = byUri(await getApp(config, cache));

    await fs.writeFile(abs('app/views/partials/c.liquid'), '<div>c</div>', 'utf8');
    const after = byUri(await getApp(config, cache));

    expect(after.size).toBe(4);
    expect(after.has(workspace.uri('app/views/partials/c.liquid'))).toBe(true);
    expect(after.get(workspace.uri('app/views/partials/b.liquid'))).toBe(
      first.get(workspace.uri('app/views/partials/b.liquid')),
    );
  });

  it('drops a removed file (prunes the cache) and reuses the rest', async () => {
    const cache = new AppCache();
    const first = byUri(await getApp(config, cache));

    await fs.rm(abs('app/views/partials/a.liquid'));
    const after = byUri(await getApp(config, cache));

    expect(after.size).toBe(2);
    expect(cache.size).toBe(2);
    expect(after.has(workspace.uri('app/views/partials/a.liquid'))).toBe(false);
    expect(after.get(workspace.uri('app/views/partials/b.liquid'))).toBe(
      first.get(workspace.uri('app/views/partials/b.liquid')),
    );
  });

  it('without a cache, parses fresh every call (original behaviour untouched)', async () => {
    const first = byUri(await getApp(config)); // no cache
    const second = byUri(await getApp(config)); // no cache

    expect(first.size).toBe(3);
    for (const [uri, source] of first) {
      expect(second.get(uri)).not.toBe(source); // fresh parse ⇒ different instances
    }
  });

  it('lintBuffer with a shared cache stays never-stale: a newly-created on-disk partial is reconciled', async () => {
    // Re-configure with MissingPartial enabled for this assertion.
    await fs.writeFile(
      configPath,
      ['extends: platformos-check:nothing', 'MissingPartial:', '  enabled: true', ''].join('\n'),
      'utf8',
    );
    const cache = new AppCache();
    const pageFile = abs('app/views/pages/home.liquid');
    const lint = () =>
      lintBuffer({ root, filePath: pageFile, content: "{% render 'ghost' %}", configPath, cache });

    // Cold: 'ghost' does not exist → MissingPartial.
    const before = await lint();
    expect(before.some((o) => o.check === 'MissingPartial')).toBe(true);

    // Create the partial on disk; the SAME cache must reconcile it (not serve stale).
    await fs.writeFile(abs('app/views/partials/ghost.liquid'), '<div>ghost</div>', 'utf8');
    const after = await lint();
    expect(after.some((o) => o.check === 'MissingPartial')).toBe(false);
  });
});
