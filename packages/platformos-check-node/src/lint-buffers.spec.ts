import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { URI } from 'vscode-uri';
import { uriFromPath } from '@platformos/platformos-common';

import { lintBuffer, lintBuffers, type LintBufferResult } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * TASK-17: `lintBuffers` lints N buffers in ONE pass over the project, and
 * {@link lintBuffer} delegates to it so there is a single overlay/restore path.
 *
 * Two independent reasons, and the second matters more:
 *
 * 1. SPEED. Everything expensive is per-project, not per-buffer: resolving the config,
 *    walking and reconciling the shared `App`, reconciling the route table. N single
 *    calls repeat all of it N times against an unchanged project.
 * 2. CORRECTNESS. With every buffer overlaid at once, a partial introduced in one buffer
 *    resolves for a `render` in another. Linting the same coordinated edit file-by-file
 *    reports `MissingPartial` for a file that exists in the very batch being checked — a
 *    false positive inherent to the single-buffer shape, not a tuning problem.
 *
 * The result key is built with `uriFromPath`, the SAME conversion production uses. Never
 * `URI.file(...).toString()`, which percent-encodes the drive colon and so yields
 * `file:///c%3A/...` against production's `file:///c:/...`. Those agree on POSIX, which is
 * exactly how the wrong spelling passes locally and fails on Windows CI — and fails
 * misleadingly, because a missing key reads as "no offenses" rather than "no such file".
 */
describe('Integration: lintBuffers', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  const absolute = (relativePath: string) => path.join(root, ...relativePath.split('/'));
  const uriOf = (relativePath: string) => uriFromPath(absolute(relativePath));

  const resultFor = (results: Map<string, LintBufferResult>, relativePath: string) =>
    results.get(uriOf(relativePath));

  const messagesFor = (results: Map<string, LintBufferResult>, relativePath: string) =>
    (resultFor(results, relativePath)?.offenses ?? []).map((offense) => offense.message);

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
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

  it('THE CORRECTNESS WIN: a partial added in one buffer resolves a render in another', async () => {
    // Neither file exists on disk yet: a coordinated edit adding a page and the partial
    // it renders, exactly what an agent writes in one step.
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/new.liquid'), content: "{% render 'fresh' %}" },
        { filePath: absolute('app/views/partials/fresh.liquid'), content: '<p>hi</p>' },
      ],
    });

    expect(messagesFor(results, 'app/views/pages/new.liquid')).toEqual([]);
    expect(resultFor(results, 'app/views/pages/new.liquid')?.status).toEqual('checked');
  });

  it('CONTRAST: the same edit linted one file at a time reports a false MissingPartial', async () => {
    // The control for the test above. Without it, that assertion would also pass if
    // `MissingPartial` had simply stopped working — and this is the false positive that
    // is inherent to the single-buffer shape, so it must be shown to be real.
    const alone = await lintBuffer({
      root,
      configPath,
      filePath: absolute('app/views/pages/new.liquid'),
      content: "{% render 'fresh' %}",
    });

    expect(alone.status).toEqual('checked');
    expect(alone.offenses.map((offense) => offense.message)).toEqual(["'fresh' does not exist"]);
  });

  it('still reports a partial missing from BOTH the batch and disk', async () => {
    // The other control: overlaying buffers must not suppress a genuinely missing target.
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/new.liquid'), content: "{% render 'nowhere' %}" },
        { filePath: absolute('app/views/partials/fresh.liquid'), content: '<p>hi</p>' },
      ],
    });

    expect(messagesFor(results, 'app/views/pages/new.liquid')).toEqual([
      "'nowhere' does not exist",
    ]);
  });

  it('attributes each offense to its own file', async () => {
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/a.liquid'), content: "{% render 'missing_a' %}" },
        { filePath: absolute('app/views/pages/b.liquid'), content: "{% render 'missing_b' %}" },
      ],
    });

    expect(messagesFor(results, 'app/views/pages/a.liquid')).toEqual([
      "'missing_a' does not exist",
    ]);
    expect(messagesFor(results, 'app/views/pages/b.liquid')).toEqual([
      "'missing_b' does not exist",
    ]);
  });

  it('returns a checked entry for every requested buffer, empty when clean', async () => {
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'card' %}" },
        { filePath: absolute('app/views/partials/card.liquid'), content: '<div>ok</div>' },
      ],
    });

    // Whole value: a key per requested buffer, each `checked` and clean. A MISSING key
    // would mean "not checked", which is a different claim from "clean".
    expect(
      [...results.entries()].map(([uri, result]) => [uri, result.status, result.offenses]),
    ).toEqual([
      [uriOf('app/views/pages/index.liquid'), 'checked', []],
      [uriOf('app/views/partials/card.liquid'), 'checked', []],
    ]);
  });

  it('agrees with lintBuffer for a single buffer', async () => {
    const single = await lintBuffer({
      root,
      configPath,
      filePath: absolute('app/views/pages/index.liquid'),
      content: "{% render 'gone' %}",
    });
    const batched = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'gone' %}" },
      ],
    });

    // `lintBuffer` delegates here, so this pins the PUBLIC contract rather than two
    // implementations: the one-buffer batch entry IS what the single seam returns.
    expect(single).toEqual(resultFor(batched, 'app/views/pages/index.liquid'));
    expect(single.offenses.map((offense) => offense.message)).toEqual(["'gone' does not exist"]);
  });

  it('deduplicates two entries for the same file, last one winning', async () => {
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'first' %}" },
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'second' %}" },
      ],
    });

    // One entry, and the LAST content is what was linted. Overlaying twice would double
    // every offense for the file.
    expect(results.size).toEqual(1);
    expect(messagesFor(results, 'app/views/pages/index.liquid')).toEqual([
      "'second' does not exist",
    ]);
  });

  it('returns an empty map for an empty batch', async () => {
    expect(await lintBuffers({ root, configPath, buffers: [] })).toEqual(new Map());
  });

  /**
   * The overlay must not outlive the call: the `App` is process-level, so one request's
   * unsaved content is not the next request's truth. A batch overlays several files, so
   * it has several overlays to revert — and reverting only some of them is the bug this
   * pins.
   */
  it('reverts EVERY overlay, so a later call sees the files on disk again', async () => {
    await lintBuffers({
      root,
      configPath,
      buffers: [
        // Two partials that do NOT exist on disk. Both must be REMOVED from the app
        // afterwards — reverting only some of them is the bug this pins, and asserting
        // both is what makes it order-independent.
        { filePath: absolute('app/views/partials/ghost_one.liquid'), content: '<p>1</p>' },
        { filePath: absolute('app/views/partials/ghost_two.liquid'), content: '<p>2</p>' },
        // An edit to a file that DOES exist, which must be invalidated back to disk.
        { filePath: absolute('app/views/pages/index.liquid'), content: '<p>edited</p>' },
      ],
    });

    // Neither phantom partial may still resolve. If either overlay survived, its render
    // would be considered fine and this list would be short.
    const after = await lintBuffer({
      root,
      configPath,
      filePath: absolute('app/views/pages/index.liquid'),
      content: "{% render 'ghost_one' %}{% render 'ghost_two' %}{% render 'card' %}",
    });
    expect(after.offenses.map((offense) => offense.message)).toEqual([
      "'ghost_one' does not exist",
      "'ghost_two' does not exist",
    ]);
  });
});

/**
 * Every buffer gets its OWN status, so a batch mixing kinds answers each on its own
 * terms. An empty `offenses` list is only an answer when `status` is `checked`; for
 * every other status it means "nothing looked at this file", and a write gate that
 * conflates the two approves a file no check ever read.
 */
describe('Integration: lintBuffers reports what it did NOT check', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  const absolute = (relativePath: string) => path.join(root, ...relativePath.split('/'));
  const uriOf = (relativePath: string) => uriFromPath(absolute(relativePath));

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'ignore:',
        '  - app/views/pages/vendor/**',
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        assets: { 'app.js': 'console.log(1);' },
        views: {
          pages: {
            'index.liquid': "{% render 'card' %}",
            vendor: { 'legacy.liquid': "{% render 'gone' %}" },
          },
          partials: { 'card.liquid': '<div></div>' },
        },
      },
      'README.md': '# not platformOS',
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('partitions a mixed request, one status per buffer', async () => {
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        // Checked, and offending.
        { filePath: absolute('app/views/pages/index.liquid'), content: "{% render 'gone' %}" },
        // Excluded by the project's ignore list.
        {
          filePath: absolute('app/views/pages/vendor/legacy.liquid'),
          content: "{% render 'gone' %}",
        },
        // An app file nothing parses.
        { filePath: absolute('app/assets/app.js'), content: 'console.log(2);' },
        // Not a platformOS source at all.
        { filePath: absolute('README.md'), content: '# still not' },
        // A source in no deployed subtree.
        { filePath: absolute('scratch/card.liquid'), content: '<div></div>' },
      ],
    });

    expect(
      [...results.entries()].map(([uri, result]) => [uri, result.status, result.offenses.length]),
    ).toEqual([
      [uriOf('app/views/pages/index.liquid'), 'checked', 1],
      [uriOf('app/views/pages/vendor/legacy.liquid'), 'excluded-by-config', 0],
      [uriOf('app/assets/app.js'), 'not-a-source-file', 0],
      [uriOf('README.md'), 'not-a-platformos-file', 0],
      [uriOf('scratch/card.liquid'), 'misplaced-source', 0],
    ]);
  });

  it('CONTRAST: the ignored path is checked, and offends, once the config stops ignoring it', async () => {
    // Without this the assertion above would also pass if the file simply had nothing
    // to report — the silence has to be caused by the `ignore` list.
    const permissive = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { pages: { vendor: { 'legacy.liquid': "{% render 'gone' %}" } } } },
    });
    try {
      const permissiveRoot = URI.parse(permissive.rootUri).fsPath;
      const results = await lintBuffers({
        root: permissiveRoot,
        configPath: path.join(permissiveRoot, '.platformos-check.yml'),
        buffers: [
          {
            filePath: path.join(permissiveRoot, 'app', 'views', 'pages', 'vendor', 'legacy.liquid'),
            content: "{% render 'gone' %}",
          },
        ],
      });

      expect(
        [...results.values()].map((result) => [result.status, result.offenses.length]),
      ).toEqual([['checked', 1]]);
    } finally {
      await permissive.clean();
    }
  });

  it('does not walk the project when every buffer is ignored', async () => {
    // The ignore decision is made from the config alone, before the app is walked — the
    // same ordering the single-buffer seam has. Asserted through the result rather than a
    // spy: an ignored-only batch answers without ever needing a project.
    const results = await lintBuffers({
      root,
      configPath,
      buffers: [
        { filePath: absolute('app/views/pages/vendor/legacy.liquid'), content: 'anything' },
      ],
    });

    expect([...results.values()]).toEqual([{ status: 'excluded-by-config', offenses: [] }]);
  });
});
