import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getApp, loadConfig, resetRouteTable, resetSharedApp } from './index';
import { MAX_RETAINED_FILES } from './shared-app';
import { Tree, Workspace, lintBufferOffenses, makeTempWorkspace } from './test/test-helpers';

/**
 * Pins TASK-12.19: the `App` is built once per process and reconciled per call, so a
 * warm call stops paying to rebuild it — WITHOUT pinning a stale view of a project
 * that an agent is editing out of band between calls.
 *
 * Every test here is the same shape: lint, change the project on disk, lint again,
 * and require the second answer to be the one a freshly built app would have given.
 */
describe('the shared app', () => {
  let workspace: Workspace | undefined;

  beforeEach(() => {
    resetSharedApp();
    resetRouteTable();
  });

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
    resetSharedApp();
    resetRouteTable();
  });

  const config = [
    'extends: platformos-check:nothing',
    'MissingPartial:',
    '  enabled: true',
    'PartialCallArguments:',
    '  enabled: true',
    '',
  ].join('\n');

  /** A page rendering `card`, over whichever partials the test starts with. */
  function projectTree(partials: Tree = {}): Tree {
    return {
      '.platformos-check.yml': config,
      app: {
        views: {
          partials,
          pages: { 'home.liquid': "{% render 'card' %}" },
        },
      },
    };
  }

  async function lintHome(): Promise<string[]> {
    const root = workspace!.root;
    const filePath = path.join(root, 'app/views/pages/home.liquid');
    const offenses = await lintBufferOffenses({
      root,
      filePath,
      content: await fs.readFile(filePath, 'utf8'),
      configPath: path.join(root, '.platformos-check.yml'),
    });
    return offenses.map((offense) => offense.message);
  }

  it('reuses one app across calls for the same project, and builds a new one after a reset', async () => {
    workspace = await makeTempWorkspace(projectTree());
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const first = await getApp(resolved);
    const second = await getApp(resolved);
    resetSharedApp();
    const third = await getApp(resolved);

    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it('sees a partial ADDED between two calls', async () => {
    workspace = await makeTempWorkspace(projectTree());

    expect(await lintHome()).toEqual(["'card' does not exist"]);

    await write('app/views/partials/card.liquid', '<b>card</b>');

    expect(await lintHome()).toEqual([]);
  });

  it('sees a partial DELETED between two calls', async () => {
    workspace = await makeTempWorkspace(projectTree({ 'card.liquid': '<b>card</b>' }));

    expect(await lintHome()).toEqual([]);

    await fs.rm(path.join(workspace.root, 'app/views/partials/card.liquid'));

    expect(await lintHome()).toEqual(["'card' does not exist"]);
  });

  it('sees a partial CHANGED between two calls, after the first call has read it', async () => {
    // `{% doc %}` params are the case where the first call does not merely resolve
    // the partial but READS and PARSES it, so a shared app that never revalidated
    // would answer the second call from the first call's AST.
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': config,
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}',
          },
          pages: { 'home.liquid': "{% render 'card', title: 'hi' %}" },
        },
      },
    });

    expect(await lintHome()).toEqual([]);

    await write(
      'app/views/partials/card.liquid',
      '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
    );

    expect(await lintHome()).toEqual([
      'Unknown parameter title passed to render call',
      'Required parameter subtitle must be passed to render call',
    ]);
  });

  it("does not let one call's unsaved buffer leak into the next call", async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': config,
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}',
          },
          pages: { 'home.liquid': "{% render 'card', title: 'hi' %}" },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    // A buffer that renames the param, never written to disk.
    await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/partials/card.liquid'),
      content: '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
      configPath,
    });

    // The next call must see the file as it is on DISK, which still says `title`.
    expect(await lintHome()).toEqual([]);
  });

  it('does not keep a file that only ever existed as an unsaved buffer', async () => {
    workspace = await makeTempWorkspace(projectTree());
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    // `card` is validated before it is saved: it exists for this call only.
    expect(
      await lintBufferOffenses({
        root,
        filePath: path.join(root, 'app/views/partials/card.liquid'),
        content: '<b>card</b>',
        configPath,
      }),
    ).toEqual([]);

    // So the page rendering it is still rendering something that does not exist.
    expect(await lintHome()).toEqual(["'card' does not exist"]);
  });

  it('stops holding sources once more than the cap are retained', async () => {
    // A whole-project run loads the project. Without a cap, an app that lives as long
    // as the process would go on holding all of it — which is the memory the lazy
    // model exists to not spend.
    const partials = Object.fromEntries(
      Array.from({ length: MAX_RETAINED_FILES + 10 }, (_, i) => [`p${i}.liquid`, `<b>${i}</b>`]),
    );
    workspace = await makeTempWorkspace(projectTree(partials));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved);
    await app.load();
    const loadedAfterWholeProjectRun = app.all().filter((file) => file.loaded).length;

    await getApp(resolved);

    expect(loadedAfterWholeProjectRun).toBe(MAX_RETAINED_FILES + 11);
    expect(app.all().filter((file) => file.loaded).length).toBe(MAX_RETAINED_FILES);
  });

  async function write(relativePath: string, content: string): Promise<void> {
    const target = path.join(workspace!.root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
});
