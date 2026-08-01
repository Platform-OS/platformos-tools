import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URI } from 'vscode-uri';

import {
  AppCache,
  lintBuffer,
  lintBuffers,
  path as uriPath,
  type LintBuffersResult,
} from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * The key `lintBuffers` reports results under, built through the SAME conversion
 * production uses.
 *
 * It must be `toUri`, never `URI.file(...).toString()`: the latter percent-encodes
 * the drive colon, so on Windows it yields `file:///c%3A/...` against production's
 * `file:///c:/...`. The two are identical on POSIX, which is exactly why the wrong
 * spelling passed locally and failed on Windows CI — and failed misleadingly,
 * because `.get(wrongKey) ?? []` reports "no offenses" rather than "no such key".
 */
const keyFor = (root: string, relativePath: string) =>
  uriPath.toUri(path.join(root, ...relativePath.split('/')));

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

  const uriOf = (relativePath: string) => keyFor(root, relativePath);

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

  const messagesFor = (result: LintBuffersResult, relativePath: string) =>
    (result.offenses.get(uriOf(relativePath)) ?? []).map((offense) => offense.message);

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

    expect([...byFile.offenses.keys()].sort()).toEqual(
      [uriOf('app/views/pages/index.liquid'), uriOf('app/views/partials/card.liquid')].sort(),
    );
    expect([...byFile.offenses.values()]).toEqual([[], []]);
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

    expect(batched.offenses.get(uriOf('app/views/pages/index.liquid'))).toEqual(single);
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

    expect(byFile.offenses.size).toEqual(1);
    // The LAST content wins, so the clean version is what was linted.
    expect(messagesFor(byFile, 'app/views/pages/index.liquid')).toEqual([]);
  });

  it('returns an empty map for an empty batch without touching the project', async () => {
    expect(await lintBuffers({ root, configPath, buffers: [] })).toEqual({
      offenses: new Map(),
      ignored: new Set(),
    });
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

/**
 * `check()` skips config-ignored files SILENTLY, so an empty offense list alone
 * cannot distinguish "checked and clean" from "never checked". A caller that guesses
 * the first reports a file as validated when nothing looked at it — that was a real
 * false approval in the MCP supervisor.
 *
 * `lintBuffers` reports the distinction because it already holds the config. It used
 * to be answered by a separate `ignoredByConfig` helper that loaded the config a
 * SECOND time, which meant two sources of truth for "is this file part of the app"
 * agreeing only by coincidence of implementation.
 */
describe('Integration: lintBuffers reports what it did NOT check', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  const uriIn = (relativePath: string) => keyFor(root, relativePath);
  const abs = (relativePath: string) => path.join(root, ...relativePath.split('/'));

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingContentForLayout:',
        '  enabled: true',
        'ignore:',
        '  - app/views/pages/**',
        '',
      ].join('\n'),
      app: {
        views: {
          pages: { 'ignored.liquid': '<div></div>' },
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

  it('reports an ignored buffer as ignored, and does NOT report it as clean', async () => {
    // Deliberately unparseable: a checked file would have plenty to say, so an empty
    // offenses entry here would be indistinguishable from a pass.
    const result = await lintBuffers({
      root,
      configPath,
      buffers: [{ filePath: abs('app/views/pages/ignored.liquid'), content: '{% if %}{{ x' }],
    });

    expect([...result.ignored]).toEqual([uriIn('app/views/pages/ignored.liquid')]);
    // Absent from `offenses` entirely — not an empty array, which would read as clean.
    expect(result.offenses.has(uriIn('app/views/pages/ignored.liquid'))).toBe(false);
  });

  it('CONTRAST: a non-ignored file with the same broken content IS checked', async () => {
    // Proves the assertion above is not vacuous — the emptiness came from the ignore
    // list, not from the checks having nothing to say.
    const result = await lintBuffers({
      root,
      configPath,
      buffers: [{ filePath: abs('app/views/layouts/theme.liquid'), content: '<html></html>' }],
    });

    expect(result.ignored).toEqual(new Set());
    expect(
      (result.offenses.get(uriIn('app/views/layouts/theme.liquid')) ?? []).map((o) => o.check),
    ).toEqual(['MissingContentForLayout']);
  });

  it('partitions a mixed request', async () => {
    const result = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: abs('app/views/pages/ignored.liquid'), content: 'x' },
        { filePath: abs('app/views/layouts/theme.liquid'), content: '<html></html>' },
      ],
    });

    expect([...result.ignored]).toEqual([uriIn('app/views/pages/ignored.liquid')]);
    expect([...result.offenses.keys()]).toEqual([uriIn('app/views/layouts/theme.liquid')]);
  });

  it('decides from the PATTERN, not from whether the file exists on disk', async () => {
    // Buffers are frequently unsaved, so existence is the wrong question.
    const result = await lintBuffers({
      root,
      configPath,
      buffers: [{ filePath: abs('app/views/pages/not-created-yet.liquid'), content: 'x' }],
    });

    expect([...result.ignored]).toEqual([uriIn('app/views/pages/not-created-yet.liquid')]);
  });

  it('does not parse an ignored buffer at all', async () => {
    // The reason the split happens BEFORE the overlay: `overlayBuffers` parses
    // eagerly, so including an ignored buffer would burn a full parse for a file
    // `check()` then skips. A syntactically broken buffer must therefore be
    // harmless here.
    const result = await lintBuffers({
      root,
      configPath,
      buffers: [{ filePath: abs('app/views/pages/ignored.liquid'), content: '{% if %}{{ ' }],
    });

    expect(result.offenses.size).toEqual(0);
    expect(result.ignored.size).toEqual(1);
  });

  it('reports nothing as ignored when the config has no ignore list', async () => {
    const plain = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingContentForLayout:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { layouts: { 'theme.liquid': '<html></html>' } } },
    });
    try {
      const otherRoot = URI.parse(plain.rootUri).fsPath;
      const result = await lintBuffers({
        root: otherRoot,
        configPath: path.join(otherRoot, '.platformos-check.yml'),
        buffers: [
          { filePath: path.join(otherRoot, 'app/views/layouts/theme.liquid'), content: '<html>' },
        ],
      });

      expect(result.ignored).toEqual(new Set());
      expect(result.offenses.size).toEqual(1);
    } finally {
      await plain.clean();
    }
  });
});
