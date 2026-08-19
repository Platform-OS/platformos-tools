import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getApp, loadConfig, resetRouteTable, resetSharedApp } from './index';
import { NodeFileSystem } from './NodeFileSystem';
import { Tree, Workspace, lintBufferOffenses, makeTempWorkspace } from './test/test-helpers';

/**
 * Pins it: the `App` is built once per process and reconciled per call, so a
 * warm call stops paying to rebuild it — WITHOUT pinning a stale view of a project
 * that an agent is editing out of band between calls.
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
    'UnrecognizedRenderPartialArguments:',
    '  enabled: true',
    'MissingRenderPartialArguments:',
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

  /**
   * The retention cap the eviction tests below reconcile under, passed per call.
   *
   * The eviction rules hold at any cap, so sizing the fixture to the SHIPPED
   * `MAX_RETAINED_FILES` bought nothing and cost 10 000 files an assertion: Windows caps a
   * process at 8192 open descriptors, so the fixture could not even be written there, and
   * three whole-project loads of it timed the spec out. The last test in this group is the
   * control that keeps a small cap honest — under the SHIPPED cap the same fixture is
   * retained whole, so an eviction observed here is one this cap caused.
   */
  const CAP = 40;

  /** Partials named so `card.liquid` sorts before every one of them. */
  function churn(count: number): Tree {
    return Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`p${i}.liquid`, `<b>${i}</b>`]),
    );
  }

  function retainedCount(app: Awaited<ReturnType<typeof getApp>>): number {
    return app.all().filter((file) => file.loaded).length;
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
      "Missing required argument 'subtitle' in render tag for partial 'card'.",
      "Unknown argument 'title' in render tag for partial 'card'.",
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

  it('keeps a fresh read at the next call, because the read recorded its own baseline', async () => {
    workspace = await makeTempWorkspace(projectTree({ 'card.liquid': '<b>card</b>' }));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved);
    const card = app.all().find((file) => file.uri.endsWith('/card.liquid'))!;

    await card.load();
    await getApp(resolved);

    expect(card.loaded).toBe(true);
  });

  // The control for the test above: a baseline trusted too widely keeps every file and serves
  // stale source to every check.
  it('still drops a file that changed after its read, baseline or not', async () => {
    workspace = await makeTempWorkspace(projectTree({ 'card.liquid': '<b>card</b>' }));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved);
    const card = app.all().find((file) => file.uri.endsWith('/card.liquid'))!;

    await card.load();
    expect(card.source).toBe('<b>card</b>');

    await fs.writeFile(path.join(workspace.root, 'app/views/partials/card.liquid'), '<i>card</i>');
    await getApp(resolved);

    expect(card.loaded).toBe(false);
    await card.load();
    expect(card.source).toBe('<i>card</i>');
  });

  it('does not wipe a buffer overlaid while its revalidation stat is in flight', async () => {
    // Revalidation snapshots the disk-backed files, then awaits a stat per file. A
    // concurrent lintBuffer can overlay a buffer onto one of them inside that
    // window, and a buffer is newer than anything on disk by construction — so the
    // version is re-read after the await, and the overlay survives. Without that,
    // the racing call would silently lint the on-disk content instead of the
    // buffer it was handed.
    workspace = await makeTempWorkspace(projectTree({ 'card.liquid': '<b>card</b>' }));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved);
    const card = app.all().find((file) => file.uri.endsWith('/card.liquid'))!;
    // Loaded from disk with no baseline: the very case revalidation would
    // otherwise invalidate unconditionally.
    await card.load();

    const stat = NodeFileSystem.stat;
    const spy = vi.spyOn(NodeFileSystem, 'stat').mockImplementation(async (uri) => {
      // The overlay lands exactly inside revalidation's stat of this file.
      if (uri === card.uri) app.setSource(card.uri, 'unsaved buffer', 0);
      return stat(uri);
    });

    try {
      await getApp(resolved);
      expect([card.loaded, card.version, card.loadedSource]).toEqual([true, 0, 'unsaved buffer']);
    } finally {
      spy.mockRestore();
    }
  });

  it('stops holding sources once more than the cap are retained', async () => {
    // A whole-project run loads the project. Without a cap, an app that lives as long
    // as the process would go on holding all of it — which is the memory the lazy
    // model exists to not spend.
    workspace = await makeTempWorkspace(projectTree(churn(CAP + 10)));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved, CAP);
    await app.load();
    const loadedAfterWholeProjectRun = retainedCount(app);

    // First reconcile: nothing has a baseline yet, so every fresh read is dropped
    // and rebaselined. The second load + reconcile is the steady state the cap
    // exists for: everything retained, everything vouched for — and over the cap.
    await getApp(resolved, CAP);
    await app.load();
    await getApp(resolved, CAP);

    expect(loadedAfterWholeProjectRun).toBe(CAP + 11);
    expect(retainedCount(app)).toBe(CAP);
  });

  it('evicts by USE, not by first read: the recurring working set survives the churn', async () => {
    // The workload the cap exists for: an agent revalidating one file in a loop
    // keeps consulting that file's render targets, which are among the EARLIEST
    // reads of the process. Evicting in first-read order threw out exactly that
    // working set; eviction is by `lastTouch` now, so what goes is what no recent
    // call consulted. Pinned by counting reads: staying retained means the next
    // consultation costs none.
    workspace = await makeTempWorkspace(
      projectTree({ 'card.liquid': '<b>card</b>', ...churn(CAP + 20) }),
    );
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const reads: string[] = [];
    const readFile = NodeFileSystem.readFile;
    const spy = vi.spyOn(NodeFileSystem, 'readFile').mockImplementation(async (uri) => {
      reads.push(uri);
      return readFile(uri);
    });

    try {
      const app = await getApp(resolved, CAP);
      const card = app.all().find((file) => file.uri.endsWith('/card.liquid'))!;

      // Reach the steady state. The reconcile keeps everything it revalidates, so the second
      // `load()` re-reads only what its EVICTION dropped.
      await app.load();
      await getApp(resolved, CAP);
      await app.load();

      // `card` was read FIRST (alphabetically before every pN in each load pass) —
      // and is consulted last, the way a loop's render target keeps being.
      await card.load();

      // This reconcile is over the cap and must evict — but not the working set.
      await getApp(resolved, CAP);
      expect(card.loaded).toBe(true);

      // Two reads: the initial one, and one because the reconcile above EVICTED `card` — it
      // was read first, so it held the lowest `lastTouch` in an over-cap project. Consulting
      // it again after eviction ran costs no third.
      await card.load();
      expect(reads.filter((uri) => uri === card.uri).length).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  // The control for the two tests above, which reconcile under a cap of their own so that a
  // fixture no platform struggles with can exceed it: under the SHIPPED cap the same fixture
  // is retained whole, so the eviction they observe is theirs rather than something a
  // whole-project run does anyway — and `getApp`'s default is still the shipped cap, which a
  // small fixture cannot otherwise see.
  it('evicts nothing at that fixture size under the shipped cap', async () => {
    workspace = await makeTempWorkspace(projectTree(churn(CAP + 10)));
    const resolved = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(resolved);
    await app.load();
    const loadedAfterWholeProjectRun = retainedCount(app);

    await getApp(resolved);
    await app.load();
    await getApp(resolved);

    expect([loadedAfterWholeProjectRun, retainedCount(app)]).toEqual([CAP + 11, CAP + 11]);
  });

  async function write(relativePath: string, content: string): Promise<void> {
    const target = path.join(workspace!.root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
});
