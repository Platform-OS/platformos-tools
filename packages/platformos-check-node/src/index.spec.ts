import fs from 'node:fs/promises';
import nodePath from 'node:path';
import path from 'node:path';
import { UnreadableDirectoryError, normalizeUri, uriFromPath } from '@platformos/platformos-common';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'vscode-uri';

import {
  Config,
  Offense,
  SourceCodeType,
  appCheckRun,
  getApp,
  getAppAndConfig,
  lintBuffer,
  lintBuffers,
  loadConfig,
  resetPlatformOSLiquidDocsManager,
  updateDocs,
  type LintBufferResult,
} from './index';
import {
  Tree,
  Workspace,
  lintBufferOffenses,
  makeTempWorkspace,
  withCountedLiquidParses,
} from './test/test-helpers';

/**
 * Records the log sink of every docs manager constructed in this process.
 * Deliberately NOT reset between tests: the point under test is that the manager
 * is built once for the whole process, so the count must stay at 1 as further
 * lint runs happen.
 */
const constructions: Array<(message: string) => void> = [];

vi.mock('@platformos/platformos-check-docs-updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/platformos-check-docs-updater')>();

  class CountingDocsManager extends actual.PlatformOSLiquidDocsManager {
    constructor(log: (message: string) => void = () => {}) {
      super(log);
      constructions.push(log);
    }
  }

  return {
    ...actual,
    PlatformOSLiquidDocsManager: CountingDocsManager,
    // Stubbed so `updateDocs` performs no network I/O in tests.
    downloadPlatformOSLiquidDocs: vi.fn(async () => {}),
  };
});

describe('Unit: getApp', () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      app: {
        translations: {
          'en.yml': 'en:\n  hello: Hello',
        },
        views: {
          partials: {
            'header.liquid': '',
          },
        },
      },
    });
  });

  afterEach(async () => {
    await workspace.clean();
  });

  it('should correctly get app on all platforms', async () => {
    const config: Config = {
      checks: [],
      rootUri: workspace.rootUri,
      settings: {},
    };

    const app = await getApp(config);
    const yamlFile = app.all().find((file) => file.type === SourceCodeType.YAML);
    assert(yamlFile);

    // Both sides are normalized URIs — `workspace.uri` builds one from the root the
    // same way the walk does, so this holds on Windows without a local fix-up.
    expect(yamlFile.uri).to.equal(workspace.uri('app/translations/en.yml'));
  });

  it('reads and parses nothing', async () => {
    const config: Config = {
      checks: [],
      rootUri: workspace.rootUri,
      settings: {},
    };

    const app = await getApp(config);

    expect(app.all().map((file) => [file.relativePath, file.loaded])).toEqual([
      ['app/translations/en.yml', false],
      ['app/views/partials/header.liquid', false],
    ]);
  });
});

describe('Unit: getApp file discovery', () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      app: {
        graphql: {
          tmp: { 'draft.graphql': 'query draft { records { total_entries } }' },
        },
        lib: {
          commands: {
            // Real commands live under a directory called `build` on a real project.
            build: { 'run.liquid': '' },
          },
        },
        views: {
          pages: {
            // An entire section of a real site lives under `pages/vendor`.
            vendor: { 'dashboard.liquid': '' },
          },
        },
      },
      modules: {
        core: {
          public: { views: { partials: { 'button.liquid': '' } } },
          // A module's own tooling is not under public/ or private/, so it is not
          // part of the app however deep its dependencies nest.
          'react-app': {
            node_modules: { pkg: { app: { graphql: { 'query.graphql': '' } } } },
          },
        },
      },
      // Every one of these spells a real app directory, and not one of them is an
      // app file: from the ROOT they are under tmp/, node_modules/ and .git/.
      tmp: {
        app: { views: { partials: { 'partial.liquid': '' } } },
      },
      node_modules: {
        'some-package': { app: { views: { partials: { 'header.liquid': '' } } } },
      },
      '.git': {
        app: { views: { partials: { 'hook.liquid': '' } } },
      },
    });
  });

  afterEach(async () => {
    await workspace.clean();
  });

  it('takes every file under an app subtree and nothing outside one', async () => {
    const config: Config = {
      checks: [],
      rootUri: workspace.rootUri,
      settings: {},
    };

    const app = await getApp(config);

    // Sorted: `all()` is in walk order, which the filesystem decides.
    expect(
      app
        .all()
        .map((file) => file.relativePath)
        .sort(),
    ).toEqual([
      'app/graphql/tmp/draft.graphql',
      'app/lib/commands/build/run.liquid',
      'app/views/pages/vendor/dashboard.liquid',
      'modules/core/public/views/partials/button.liquid',
    ]);
  });
});

/**
 * The walk replaced a `glob`, and these are the cases where a walk and a glob can
 * legitimately disagree. Two of them are pinned to keep the glob's answer; the third
 * is a deliberate difference.
 */
describe('Unit: getApp walk edge cases', () => {
  const posixOnly = process.platform === 'win32' ? it.skip : it;
  let workspace: Workspace;

  const config = (): Config => ({ checks: [], rootUri: workspace.rootUri, settings: {} });

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      app: { views: { partials: { 'card.liquid': '' } } },
      outside: { 'stray.liquid': '' },
    });
  });

  afterEach(async () => {
    await workspace.clean();
  });

  it('skips hidden files and hidden directories', async () => {
    const partials = nodePath.join(workspace.root, 'app', 'views', 'partials');
    // An Emacs lock file, an AppleDouble copy, and an editor's backup directory.
    await fs.writeFile(nodePath.join(partials, '.#card.liquid'), '');
    await fs.writeFile(nodePath.join(partials, '._card.liquid'), '');
    await fs.mkdir(nodePath.join(partials, '.old'));
    await fs.writeFile(nodePath.join(partials, '.old', 'card.liquid'), '');

    const app = await getApp(config());

    expect(app.all().map((file) => file.relativePath)).toEqual(['app/views/partials/card.liquid']);
  });

  posixOnly('does not follow a symlinked directory, and takes a symlinked file', async () => {
    const partials = nodePath.join(workspace.root, 'app', 'views', 'partials');
    await fs.symlink(nodePath.join(workspace.root, 'outside'), nodePath.join(partials, 'linked'));
    await fs.symlink(
      nodePath.join(partials, 'card.liquid'),
      nodePath.join(partials, 'link.liquid'),
    );

    const app = await getApp(config());

    expect(
      app
        .all()
        .map((file) => file.relativePath)
        .sort(),
    ).toEqual(['app/views/partials/card.liquid', 'app/views/partials/link.liquid']);
  });

  // DELIBERATELY not what the glob did: it skipped an unreadable directory in
  // silence, which is a lint that quietly covers less of the project than it says.
  posixOnly('surfaces a directory it cannot read instead of linting a smaller app', async () => {
    if (process.getuid?.() === 0) return; // root reads everything; nothing to assert
    const secret = nodePath.join(workspace.root, 'app', 'views', 'partials', 'secret');
    await fs.mkdir(secret);
    await fs.writeFile(nodePath.join(secret, 'hidden.liquid'), '');
    await fs.chmod(secret, 0o000);

    try {
      const error = await getApp(config()).then(
        () => undefined,
        (e) => e,
      );

      // Typed and explained, not a raw `scandir` stack: this is the value the CLI
      // prints verbatim, so what it says here is what the user reads.
      expect(error).toBeInstanceOf(UnreadableDirectoryError);
      // Normalized on the way in: the walk echoes whatever spelling of `rootUri` it
      // was handed (here `file:/tmp/…`, not `file:///tmp/…`), which is also why the
      // MESSAGE names the directory relatively rather than pasting the URI.
      expect(normalizeUri(error.uri)).toBe(workspace.uri('app/views/partials/secret'));
      expect(error.message.split('\n')).toEqual([
        'Cannot read directory: app/views/partials/secret',
        `  EACCES: permission denied, scandir '${secret}'`,
        '',
        'It is inside the app, so its contents would be deployed, and skipping it ' +
          'would mean reporting on only part of the project. ' +
          "Fix the directory's permissions, or move it out of the app, then run again.",
      ]);
    } finally {
      await fs.chmod(secret, 0o755);
    }
  });
});

/**
 * Pins the typed seam the MCP supervisor lints through: `lintBuffer` overlays an
 * in-memory buffer onto the on-disk project and returns structured `Offense[]`
 * (fix/suggest + range intact) — no LSP, no message round-trip.
 */
describe('Unit: lintBuffer', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;

  afterEach(async () => {
    await workspace?.clean();
  });

  describe('structured offense shape (fix preserved end to end)', () => {
    beforeEach(async () => {
      workspace = await makeTempWorkspace({
        // Enable only a docset-independent, autofixable check so the test is hermetic.
        '.platformos-check.yml': [
          'extends: platformos-check:nothing',
          'JsonLiteralQuoteStyle:',
          '  enabled: true',
          '',
        ].join('\n'),
        app: {
          views: {
            partials: {
              // Benign on disk (double-quoted keys) — the offense must come from the buffer.
              'card.liquid': '{% assign a = {"a": 5} %}',
            },
          },
        },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('returns a structured Offense with check code, numeric range, and a fix for the overlaid buffer', async () => {
      const filePath = path.join(root, 'app/views/partials/card.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% assign a = {'a': 5} %}",
        configPath,
      });

      expect(offenses).toHaveLength(1);
      const [offense] = offenses;
      expect(offense.check).toEqual('JsonLiteralQuoteStyle');
      expect(offense.fix).toBeTypeOf('function');
      expect(typeof offense.start.index).toBe('number');
      expect(typeof offense.end.index).toBe('number');
      expect(offense.end.index).toBeGreaterThan(offense.start.index);
    });
  });

  describe('cross-file checks resolve against the on-disk project with the buffer overlaid', () => {
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
            partials: {
              'exists.liquid': 'hello',
            },
            pages: {
              // Benign on disk — the render call comes from the buffer.
              'home.liquid': '',
            },
          },
        },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    it('does NOT flag MissingPartial when the buffer renders a partial that exists on disk', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% render 'exists' %}",
        configPath,
      });

      expect(offenses.filter((offense) => offense.check === 'MissingPartial')).toEqual([]);
    });

    it('flags MissingPartial when the buffer renders a partial that does not exist', async () => {
      const filePath = path.join(root, 'app/views/pages/home.liquid');
      const offenses = await lintBufferOffenses({
        root,
        filePath,
        content: "{% render 'ghost' %}",
        configPath,
      });

      expect(offenses.some((offense) => offense.check === 'MissingPartial')).toBe(true);
    });
  });

  /**
   * The three paths that are never linted. An empty `Offense[]` for any of them is the
   * same answer a clean file gives, so a caller asking "is this file OK?" would be told
   * "yes" about a file nothing looked at.
   */
  describe('says when it did not check the file', () => {
    const content = ["{{ 'x' | no_such_filter }}", "{% render 'ghost' %}", ''].join('\n');

    beforeEach(async () => {
      workspace = await makeTempWorkspace({
        '.platformos-check.yml': [
          'ignore:',
          '  - modules/vendored/**',
          'extends: platformos-check:nothing',
          'MissingPartial:',
          '  enabled: true',
          '',
        ].join('\n'),
        app: {
          assets: { 'app.js': 'console.log(1);' },
          views: { partials: { 'card.liquid': 'hello' } },
        },
        modules: {
          vendored: { public: { views: { partials: { 'button.liquid': 'hi' } } } },
        },
        scripts: { 'helper.liquid': 'hi' },
      });
      root = workspace.root;
      configPath = path.join(root, '.platformos-check.yml');
    });

    const lint = (relativePath: string) =>
      lintBuffer({ root, filePath: path.join(root, relativePath), content, configPath });

    it('checked: an app file the config includes', async () => {
      const result = await lint('app/views/partials/card.liquid');

      expect({
        status: result.status,
        checks: result.offenses.map((offense) => offense.check),
      }).toEqual({ status: 'checked', checks: ['MissingPartial'] });
    });

    it("excluded-by-config: a file the project's ignore list covers", async () => {
      expect(await lint('modules/vendored/public/views/partials/button.liquid')).toEqual({
        status: 'excluded-by-config',
        offenses: [],
      });
    });

    it('misplaced-source: a parseable source outside every app subtree', async () => {
      expect(await lint('scripts/helper.liquid')).toEqual({
        status: 'misplaced-source',
        offenses: [],
      });
    });

    it('not-a-platformos-file: a file that is no platformOS source at all', async () => {
      expect(await lint('src/components/Widget.jsx')).toEqual({
        status: 'not-a-platformos-file',
        offenses: [],
      });
    });

    it('not-a-source-file: an asset, which no check visits', async () => {
      expect(await lint('app/assets/app.js')).toEqual({
        status: 'not-a-source-file',
        offenses: [],
      });
    });

    it('leaves no trace of an unchecked buffer in the shared app', async () => {
      const { app } = await getAppAndConfig(root, configPath);
      const before = app
        .all()
        .map((file) => file.relativePath)
        .sort();

      await lint('app/assets/app.js');
      await lint('modules/vendored/public/views/partials/button.liquid');
      await lint('scripts/helper.liquid');

      // The app outlives the call, so a file it deliberately does not contain must
      // not be left behind by the overlay of a buffer nothing checked.
      expect(
        app
          .all()
          .map((file) => file.relativePath)
          .sort(),
      ).toEqual(before);
      // The ignored `button.liquid` is an ordinary app file; the other two lints are
      // of paths the walk never yields (no source extension / no app subtree).
      expect(before).toEqual([
        'app/views/partials/card.liquid',
        'modules/vendored/public/views/partials/button.liquid',
      ]);
    });
  });
});

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
      '.platformos-check.yml': `extends: platformos-check:nothing
MissingPartial:
  enabled: true
`,
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
      '.platformos-check.yml': `ignore:
  - app/views/pages/vendor/**
extends: platformos-check:nothing
MissingPartial:
  enabled: true
`,
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
      '.platformos-check.yml': `extends: platformos-check:nothing
MissingPartial:
  enabled: true
`,
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

/**
 * Nothing reads an asset — asserted at the layer that was actually wrong.
 *
 * `app/assets/x.liquid` used to be linted like a page. A bare `.liquid` has no response
 * format, so `sourceCodeTypeOf` falls back to `html.liquid` — a key that HAS a parser row
 * — and the file went into the app with the Liquid+HTML parser. Broken Liquid in it drew
 * `LiquidHTMLSyntaxError` from `check()`, and through the MCP supervisor a
 * `must_fix_before_write: true`: a FALSE BLOCK on a file the platform serves verbatim,
 * for the syntax of a language nothing at that path evaluates. Backwards, too —
 * `theme.css.liquid`, the asset form the platform genuinely does process, was exempt all
 * along because `css` IS a format and has no row.
 *
 * The rule lives in `platformos-common` (`isParsedFileType`, applied by `AppFile` and by
 * `isSupportedSourceFile`) and its unit coverage is there. This file exists because unit
 * coverage of a predicate is not the promise that matters: the promise is that a real
 * `check()` over a real project on disk reports nothing on an asset. Those are different
 * claims — the engine could stop consulting `AppFile.type` and every unit test would
 * still pass.
 *
 * EVERY case here is paired with a CONTROL that must still fire. A rule that silenced the
 * whole run, or a fixture with nothing to report, satisfies "no offenses on the asset"
 * just as well as the correct behaviour does.
 */
describe('assets are held by the app and never linted', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** Unparseable Liquid: an unclosed tag, which `LiquidHTMLSyntaxError` always reports. */
  const BROKEN = '{% if unclosed\n';

  /**
   * One asset per spelling that a parser would otherwise accept, plus a page holding the
   * identical broken source as the control.
   *
   * The nested and `marketplace_builder` cases are here because the rule is anchored on
   * the app root: `assets/` has to be recognised under the legacy root and at depth, not
   * just as the literal prefix `app/assets/`.
   */
  const PROJECT: Tree = {
    '.platformos-check.yml': `extends: platformos-check:nothing
LiquidHTMLSyntaxError:
  enabled: true
`,
    app: {
      assets: {
        'x.liquid': BROKEN,
        'page.html.liquid': BROKEN,
        nested: { deep: { 'w.liquid': BROKEN } },
      },
      views: { pages: { 'control.liquid': BROKEN } },
    },
    marketplace_builder: { assets: { 'legacy.liquid': BROKEN } },
  };

  it('reports the page and NOTHING under any assets directory', async () => {
    workspace = await makeTempWorkspace(PROJECT);

    const { offenses } = await appCheckRun(URI.parse(workspace.rootUri).fsPath);

    // The whole offense set, exactly: one control and no assets. Asserting the complete
    // list rather than "no asset offenses" is what makes the control load-bearing — a
    // rule that silenced everything would fail here and pass a filtered assertion.
    expect(offenses.map((offense) => offense.uri.replace(workspace!.rootUri, ''))).toEqual([
      '/app/views/pages/control.liquid',
    ]);
  });

  it('still holds the assets in the app, so they resolve as files that exist', async () => {
    workspace = await makeTempWorkspace(PROJECT);

    const { app } = await appCheckRun(URI.parse(workspace.rootUri).fsPath);

    // The other half of "nothing reads an asset, so the only question about one is
    // whether it exists". Not linted is not the same as absent: dropping assets from the
    // app would also produce zero offenses above, while silently breaking every
    // `asset_url` resolution and the graph's asset nodes.
    const assets = app
      .all()
      .map((file) => file.relativePath)
      .filter((relativePath) => relativePath.includes('/assets/'))
      .sort();

    expect(assets).toEqual([
      'app/assets/nested/deep/w.liquid',
      'app/assets/page.html.liquid',
      'app/assets/x.liquid',
      'marketplace_builder/assets/legacy.liquid',
    ]);
  });

  it('tells a buffer-level caller the asset was not checked, rather than that it is clean', async () => {
    workspace = await makeTempWorkspace(PROJECT);
    const root = URI.parse(workspace.rootUri).fsPath;

    // `lintBuffer` is the seam the MCP supervisor validates through, and an empty
    // `offenses` array is exactly what an unchecked file and a clean file have in common.
    // The status is what distinguishes them, and it is the difference between "safe to
    // write" and "we did not look".
    const asset = await lintBuffer({
      root,
      filePath: path.join(root, 'app', 'assets', 'x.liquid'),
      content: BROKEN,
    });
    const page = await lintBuffer({
      root,
      filePath: path.join(root, 'app', 'views', 'pages', 'control.liquid'),
      content: BROKEN,
    });

    expect({
      asset: { status: asset.status, offenses: asset.offenses.length },
      page: { status: page.status, checks: page.offenses.map((offense) => offense.check) },
    }).toEqual({
      asset: { status: 'not-a-source-file', offenses: 0 },
      page: { status: 'checked', checks: ['LiquidHTMLSyntaxError'] },
    });
  });
});

/**
 * An ignored file is a normal part of the app. `ignore` silences the offenses
 * reported ON it and nothing else — every other file still resolves against it.
 */
describe('files the config ignores are still visible to cross-file checks', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** A link and a form whose routes are both defined in the ignored module. */
  const HEADER = [
    '<a href="/inbox">Chat</a>',
    '<form action="/sessions" method="post">',
    '  <input type="hidden" name="_method" value="delete">',
    '</form>',
    '',
  ].join('\n');

  /** `/inbox` (GET) and `/sessions` (DELETE), as pages of an ignored module. */
  const CHAT_MODULE_PAGES: Tree = {
    'inbox.liquid': 'Inbox\n',
    'sessions.liquid': ['---', 'method: delete', '---', 'Signed out\n'].join('\n'),
  };

  function projectTree(chatPages: Tree): Tree {
    return {
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'ignore:',
        '  - modules/chat/**',
        'MissingPage:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { partials: { 'header.liquid': HEADER } } },
      modules: {
        chat: { public: { views: { pages: chatPages } } },
      },
    };
  }

  it('resolves a route defined by a page in an ignored module', async () => {
    workspace = await makeTempWorkspace(projectTree(CHAT_MODULE_PAGES));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
  });

  it('still reports the routes that no page defines', async () => {
    workspace = await makeTempWorkspace(projectTree({}));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([
      {
        check: 'MissingPage',
        uri: workspace.uri('app/views/partials/header.liquid'),
        message: "No page found for route '/inbox' (GET)",
      },
      {
        check: 'MissingPage',
        uri: workspace.uri('app/views/partials/header.liquid'),
        message: "No page found for route '/sessions' (DELETE)",
      },
    ]);
  });

  it('does not report ON the ignored module, whose own link goes nowhere', async () => {
    // `ignore` keeps its meaning: being visible to a check is not being linted by it.
    workspace = await makeTempWorkspace(
      projectTree({
        ...CHAT_MODULE_PAGES,
        'inbox.liquid': '<a href="/ghost">Nowhere</a>\n',
      }),
    );

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
  });
});

/** The offenses as a reader of `pos-cli check` output sees them. */
function reported(offenses: Offense[]) {
  return offenses
    .map((offense) => ({
      check: offense.check,
      uri: offense.uri,
      message: offense.message,
    }))
    .sort((a, b) => a.message.localeCompare(b.message));
}

/**
 * Pins the central claim: `getApp` reads and parses nothing, and a `lintBuffer` call pays
 * only for the file it visits plus the handful of files that file actually points at.
 * Parse counts are the assertion because they are the cost.
 */
describe('lazy app loading', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** A project with `partialCount` partials, one page, and one translation file. */
  function projectTree(partialCount: number): Tree {
    const partials: Record<string, string> = {};
    for (let i = 0; i < partialCount; i++) {
      partials[`p${i}.liquid`] = `<b>partial ${i}</b>`;
    }

    return {
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        'PartialCallArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        translations: { 'en.yml': 'en:\n  hello: Hello\n' },
        views: {
          partials,
          pages: { 'home.liquid': '' },
        },
      },
    };
  }

  it('getApp reads and parses nothing at all', async () => {
    workspace = await makeTempWorkspace(projectTree(300));
    const config = await loadConfig(
      path.join(workspace.root, '.platformos-check.yml'),
      workspace.root,
    );

    const app = await getApp(config);

    expect(app.size).toBe(302);
    expect(app.all().filter((file) => file.loaded)).toEqual([]);
  });

  it('lintBuffer parses only the visited file and the render targets it resolves', async () => {
    workspace = await makeTempWorkspace(projectTree(300));
    const root = workspace.root;
    await write(
      root,
      'app/views/partials/documented.liquid',
      '{% doc %}\n  @param {string} title\n{% enddoc %}\n<h1>{{ title }}</h1>\n',
    );

    const parsed = await withCountedLiquidParses(() =>
      lintBufferOffenses({
        root,
        filePath: path.join(root, 'app/views/pages/home.liquid'),
        content: "{% render 'documented', title: 'hi' %}{% render 'p7' %}",
        configPath: path.join(root, '.platformos-check.yml'),
      }),
    );

    expect(parsed.result).toEqual([]);
    // The buffer, plus `documented` and `p7` reached through render resolution — the
    // WHOLE set, not a bound on it plus a name pattern. Measured: rendering `p70` instead
    // of `p7` passes `length <= 4` with `every(/home|documented|p7/)`, because the count is
    // a bound and `/p7/` matches `p70`…`p79` — so the old pair accepted a parse of the
    // wrong file. Anything near 300 means the project is being parsed again.
    expect([...parsed.parsedUris].sort()).toEqual(
      [
        'app/views/pages/home.liquid',
        'app/views/partials/documented.liquid',
        'app/views/partials/p7.liquid',
      ].map((relativePath) => workspace!.uri(relativePath)),
    );
  });

  it('does not throw, or report, for a parse error in a file nobody visits', async () => {
    workspace = await makeTempWorkspace(projectTree(5));
    const root = workspace.root;
    await write(root, 'app/views/partials/broken.liquid', '{% if %}{% unclosed');

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: "{% render 'p1' %}",
      configPath: path.join(root, '.platformos-check.yml'),
    });

    expect(offenses).toEqual([]);
  });

  it('still reports a parse error in the file being visited', async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'LiquidHTMLSyntaxError:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { pages: { 'home.liquid': '' } } },
    });
    const root = workspace.root;

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '{% if %}',
      configPath: path.join(root, '.platformos-check.yml'),
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['LiquidHTMLSyntaxError']);
  });

  it("resolves a render target's {% doc %} params lazily, from the app", async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'UnrecognizedRenderPartialArguments:',
        '  enabled: true',
        'MissingRenderPartialArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
          },
          pages: { 'home.liquid': '' },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const homePath = path.join(root, 'app/views/pages/home.liquid');

    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: homePath,
          content: "{% render 'card', subtitle: 'hi' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([]);

    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: homePath,
          content: "{% render 'card', title: 'hi' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([
      "Missing required argument 'subtitle' in render tag for partial 'card'.",
      "Unknown argument 'title' in render tag for partial 'card'.",
    ]);
  });

  it('cross-references an unsaved buffer against its OWN {% doc %} params', async () => {
    // A self-render is the one call site whose target is the buffer itself, so it is
    // where "the buffer's doc, not the disk copy's doc" is observable. The doc comes
    // from the app — which `lintBuffer` overlays — rather than from a fresh read.
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'UnrecognizedRenderPartialArguments:',
        '  enabled: true',
        'MissingRenderPartialArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} subtitle\n{% enddoc %}{{ subtitle }}',
          },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const cardPath = path.join(root, 'app/views/partials/card.liquid');

    // Against the doc ON DISK (`subtitle`), passing `title` is wrong.
    expect(
      (
        await lintBufferOffenses({
          root,
          filePath: cardPath,
          content:
            "{% doc %}\n  @param {string} subtitle\n{% enddoc %}{% render 'card', title: 'x' %}",
          configPath,
        })
      ).map((offense) => offense.message),
    ).toEqual([
      "Missing required argument 'subtitle' in render tag for partial 'card'.",
      "Unknown argument 'title' in render tag for partial 'card'.",
    ]);

    // The buffer renaming the param to `title` is what makes the same call correct,
    // even though disk still says `subtitle`.
    expect(
      await lintBufferOffenses({
        root,
        filePath: cardPath,
        content: "{% doc %}\n  @param {string} title\n{% enddoc %}{% render 'card', title: 'x' %}",
        configPath,
      }),
    ).toEqual([]);
  });

  it('lintBuffer matches the whole-project run filtered to the same file', async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'MissingPartial:',
        '  enabled: true',
        'TranslationKeyExists:',
        '  enabled: true',
        'PartialCallArguments:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        translations: { 'en.yml': 'en:\n  known: Known\n' },
        views: {
          partials: {
            'card.liquid': '{% doc %}\n  @param {string} title\n{% enddoc %}{{ title }}',
            ...Object.fromEntries(
              Array.from({ length: 200 }, (_, i) => [`p${i}.liquid`, `<b>${i}</b>`]),
            ),
          },
          pages: {
            'home.liquid': [
              "{% render 'ghost' %}",
              "{% render 'card' %}",
              "{{ 'missing.key' | t }}",
            ].join('\n'),
            'other.liquid': "{% render 'also_ghost' %}",
          },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const homePath = path.join(root, 'app/views/pages/home.liquid');
    // The same conversion the code under test uses, so the two runs' URIs are
    // comparable on Windows too: `URI.file(p).toString()` percent-encodes the drive
    // colon, which matches nothing an `App` produced.
    const homeUri = uriFromPath(homePath);
    const content = await fs.readFile(homePath, 'utf8');

    const wholeProject = await appCheckRun(root, configPath);
    const fromBuffer = await lintBufferOffenses({ root, filePath: homePath, content, configPath });

    expect(comparable(fromBuffer)).toEqual(
      comparable(wholeProject.offenses.filter((offense) => offense.uri === homeUri)),
    );
    // Offenses elsewhere prove the filter is doing real work rather than matching an
    // empty set against an empty set.
    expect(wholeProject.offenses.some((offense) => offense.uri !== homeUri)).toBe(true);
    expect(fromBuffer.length).toBeGreaterThan(0);
  });
});

/** Offenses reduced to the fields that are comparable across two runs. */
function comparable(offenses: Offense[]) {
  return offenses
    .map((offense) => ({
      check: offense.check,
      uri: offense.uri,
      message: offense.message,
      severity: offense.severity,
      start: offense.start,
      end: offense.end,
    }))
    .sort((a, b) => `${a.check}:${a.start.index}`.localeCompare(`${b.check}:${b.start.index}`));
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

/**
 * The docset is a process-level constant, and every loader on the manager —
 * including the `setup()` network revision check — is a per-instance memo. One
 * instance per process is therefore both correct and the difference between paying
 * that network round trip once and paying it on every lint run.
 */
describe('Integration: docs manager reuse across lint runs', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;
  let filePath: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'JsonLiteralQuoteStyle:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% assign a = {"a": 5} %}',
          },
        },
      },
    });
    root = workspace.root;
    configPath = path.join(root, '.platformos-check.yml');
    filePath = path.join(root, 'app/views/partials/card.liquid');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('constructs the docs manager once, however many lint runs happen', async () => {
    await lintBufferOffenses({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    await lintBufferOffenses({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });
    await appCheckRun(root, configPath);

    expect(constructions).toHaveLength(1);
  });

  it('replays the docset’s diagnostics to each run, and never writes to a finished run’s sink', async () => {
    const earlierRunLog: string[] = [];
    const laterRunLog: string[] = [];

    await lintBufferOffenses({
      root,
      filePath,
      content: "{% assign a = {'a': 5} %}",
      configPath,
      log: (message) => earlierRunLog.push(message),
    });

    // One manager, built with a FORWARDING sink rather than the first run's logger
    // captured forever. Whatever it had already reported by then (a degraded docset
    // explains itself exactly once, since every loader is memoized) was replayed to
    // that run — possibly nothing, when the docset loaded cleanly.
    expect(constructions).toHaveLength(1);
    const alreadyReported = [...earlierRunLog];

    // A diagnostic emitted between runs is not delivered to the finished run's sink
    // behind its back...
    constructions[0]('probe');

    expect(earlierRunLog).toEqual(alreadyReported);

    // ...it is replayed to the next run instead. Without the replay, only the
    // process's FIRST run — for the MCP supervisor a `lintBuffer` call with no `log`
    // at all — ever learns why the docset is reporting valid code as unknown.
    await lintBufferOffenses({
      root,
      filePath,
      content: "{% assign b = {'b': 5} %}",
      configPath,
      log: (message) => laterRunLog.push(message),
    });

    expect(laterRunLog).toEqual([...alreadyReported, 'probe']);
  });

  it('builds a fresh manager after an explicit reset, so a changed docset is re-read', async () => {
    await lintBufferOffenses({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    const before = constructions.length;

    resetPlatformOSLiquidDocsManager();
    await lintBufferOffenses({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });

    expect(constructions.length).toEqual(before + 1);
  });

  it('drops the shared manager when updateDocs refreshes the docset', async () => {
    await lintBufferOffenses({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    const before = constructions.length;

    // Without this reset the process would keep validating against the docset it
    // read BEFORE the download — e.g. reporting a brand-new filter as unknown.
    await updateDocs();
    await lintBufferOffenses({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });

    expect(constructions.length).toEqual(before + 1);
  });

  it('still lints correctly through the shared manager', async () => {
    const offenses = await lintBufferOffenses({
      root,
      filePath,
      content: "{% assign a = {'a': 5} %}",
      configPath,
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['JsonLiteralQuoteStyle']);
  });
});

describe('Unit: updateDocs', () => {
  // BEFORE, not after: the docs-manager-reuse group above calls `updateDocs()` for its
  // own reasons, so the download mock already carries calls by the time these run. An
  // `afterEach` would clean up after a count these tests had already read.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls downloadPlatformOSLiquidDocs with the cache root and provided log function', async () => {
    const { downloadPlatformOSLiquidDocs, root } =
      await import('@platformos/platformos-check-docs-updater');
    const log = vi.fn();

    await updateDocs(log);

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledWith(root, log);
  });

  it('uses a no-op log by default', async () => {
    const { downloadPlatformOSLiquidDocs } =
      await import('@platformos/platformos-check-docs-updater');

    await updateDocs();

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
    );
  });
});
