import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { AppCache, lintBuffer, lintBuffers } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * TASK-17: `lintBuffers` lints N buffers in ONE pass over the project.
 *
 * Two independent reasons, and the second matters more:
 *
 * 1. SPEED. Everything expensive is per-project, not per-buffer (config load,
 *    glob + reconcile, the `getDocDefinition` map, the `JSONValidator`) — ~250 ms
 *    of fixed cost against ~84 ms of real per-buffer work. N single calls repeat
 *    all of it N times against an unchanged project.
 * 2. CORRECTNESS. With every buffer overlaid at once, a partial introduced in one
 *    buffer resolves for a `render` in another. Linting the same coordinated edit
 *    file-by-file reports `MissingPartial` for a file that exists in the very batch
 *    being checked — a false positive inherent to the single-buffer shape.
 */
describe('Integration: lintBuffers', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  const uriOf = (relativePath: string) =>
    URI.file(path.join(root, ...relativePath.split('/'))).toString();

  const absolute = (relativePath: string) => path.join(root, ...relativePath.split('/'));

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        'MissingContentForLayout:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          pages: { 'index.liquid': "{% render 'card' %}" },
          partials: { 'card.liquid': '<div>{{ title }}</div>' },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  const messagesFor = (byFile: Map<string, { message: string }[]>, relativePath: string) =>
    (byFile.get(uriOf(relativePath)) ?? []).map((offense) => offense.message);

  it('THE CORRECTNESS WIN: a partial added in one buffer resolves a render in another', async () => {
    // `promo` exists on neither disk nor in the page's own buffer — only in a
    // SIBLING buffer of the same batch. One-call-per-file cannot see it.
    const byFile = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'promo' %}" },
        { filePath: absolute('app/views/partials/promo.liquid'), content: '<div>promo</div>' },
      ],
    });

    expect(messagesFor(byFile, 'app/views/pages/index.liquid')).toEqual([]);
  });

  it('contrast: the SAME edit linted one file at a time reports a false MissingPartial', async () => {
    // Pins the defect the batch removes, so the win above cannot be mistaken for a
    // no-op. This is what an agent making a coordinated two-file change saw.
    const offenses = await lintBuffer({
      root,
      configPath,
      filePath: absolute('app/views/pages/index.liquid'),
      content: "{% render 'promo' %}",
    });

    expect(offenses.map((offense) => offense.message)).toEqual(["'promo' does not exist"]);
  });

  it('still reports a partial missing from BOTH the batch and disk', async () => {
    // The batch must not become permissive: only files actually present in it count.
    const byFile = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'ghost' %}" },
        { filePath: absolute('app/views/partials/promo.liquid'), content: '<div>promo</div>' },
      ],
    });

    expect(messagesFor(byFile, 'app/views/pages/index.liquid')).toEqual(["'ghost' does not exist"]);
  });

  it('attributes each offense to its own file', async () => {
    const byFile = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'ghost' %}" },
        { filePath: absolute('app/views/layouts/theme.liquid'), content: '<html></html>' },
      ],
    });

    expect(messagesFor(byFile, 'app/views/pages/index.liquid')).toEqual(["'ghost' does not exist"]);
    expect(messagesFor(byFile, 'app/views/layouts/theme.liquid')).toEqual([
      "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
    ]);
  });

  it('returns an entry for every requested buffer, empty when clean', async () => {
    // A caller must be able to distinguish "no offenses" from "not linted", so a
    // clean buffer gets `[]` rather than a missing key.
    const byFile = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'card' %}" },
        { filePath: absolute('app/views/partials/card.liquid'), content: '<div>ok</div>' },
      ],
    });

    expect([...byFile.keys()].sort()).toEqual(
      [uriOf('app/views/pages/index.liquid'), uriOf('app/views/partials/card.liquid')].sort(),
    );
    expect([...byFile.values()]).toEqual([[], []]);
  });

  it('is byte-identical to lintBuffer for a single buffer', async () => {
    const params = {
      root,
      configPath,
      filePath: absolute('app/views/pages/index.liquid'),
      content: "{% render 'ghost' %}",
    };

    const single = await lintBuffer(params);
    const batched = await lintBuffers({
      root,
      configPath,
      buffers: [{ filePath: params.filePath, content: params.content }],
    });

    expect(batched.get(uriOf('app/views/pages/index.liquid'))).toEqual(single);
  });

  it('deduplicates two entries for the same file, last one winning', async () => {
    // Overlaying the same file twice would otherwise double every offense for it.
    const file = absolute('app/views/pages/index.liquid');
    const byFile = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: file, content: "{% render 'ghost' %}" },
        { filePath: file, content: "{% render 'card' %}" },
      ],
    });

    expect(byFile.size).toEqual(1);
    // The LAST content wins, so the clean version is what was linted.
    expect(messagesFor(byFile, 'app/views/pages/index.liquid')).toEqual([]);
  });

  it('returns an empty map for an empty batch without touching the project', async () => {
    expect(await lintBuffers({ root, configPath, buffers: [] })).toEqual(new Map());
  });

  it('walks the project ONCE for the whole batch, not once per buffer', async () => {
    /**
     * The speed claim, asserted structurally rather than by timing.
     *
     * `getApp` consults the cache once per ON-DISK project file, so counting
     * `reuse` counts project passes. A counting subclass is used rather than a
     * `vi.spyOn` on a module export: check-node binds its imports at load time, so
     * spying on the namespace object would not intercept the internal call.
     */
    class CountingAppCache extends AppCache {
      reuseCalls = 0;
      override reuse(uri: string, fingerprint: string) {
        this.reuseCalls++;
        return super.reuse(uri, fingerprint);
      }
    }
    const cache = new CountingAppCache();
    // Two liquid files are on disk (index, card); the yml config is not a source.
    const PROJECT_FILES = 2;

    await lintBuffers({
      root,
      configPath,
      cache,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'card' %}" },
        { filePath: absolute('app/views/partials/card.liquid'), content: '<div>a</div>' },
        { filePath: absolute('app/views/layouts/theme.liquid'), content: '<html></html>' },
        { filePath: absolute('app/views/pages/other.liquid'), content: '<div></div>' },
      ],
    });

    // Four buffers, ONE pass over the project. Per-buffer calls would be 4x this.
    expect(cache.reuseCalls).toEqual(PROJECT_FILES);
  });

  it('reuses a shared AppCache across batches and stays never-stale', async () => {
    const cache = new AppCache();
    const page = absolute('app/views/pages/index.liquid');

    const first = await lintBuffers({
      root,
      configPath,
      cache,
      buffers: [{ filePath: page, content: "{% render 'later' %}" }],
    });
    expect(messagesFor(first, 'app/views/pages/index.liquid')).toEqual(["'later' does not exist"]);

    // Create the partial ON DISK between batches: the cached project must reconcile.
    await fs.writeFile(absolute('app/views/partials/later.liquid'), '<div>later</div>', 'utf8');

    const second = await lintBuffers({
      root,
      configPath,
      cache,
      buffers: [{ filePath: page, content: "{% render 'later' %}" }],
    });
    expect(messagesFor(second, 'app/views/pages/index.liquid')).toEqual([]);
  });
});
