import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest';
import { UnreadableDirectoryError, normalizeUri } from '@platformos/platformos-common';
import { Config, SourceCodeType, getApp } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';
import fs from 'node:fs/promises';
import nodePath from 'node:path';

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

    // internally we expect the path to be normalized
    // Use .replace() instead of normalize-path here because this is a URI (file:///...),
    // not a filesystem path — normalize-path would collapse the triple slash.
    expect(yamlFile.uri).to.equal(workspace.uri('app/translations/en.yml').replace(/\\/g, '/'));
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
            // Real commands live under a directory called `build` in Accala-MP.
            build: { 'run.liquid': '' },
          },
        },
        views: {
          pages: {
            // An entire section of htevent's site lives under `pages/vendor`.
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

// `getAppFilesPathPatterns` and its two tests were removed with the function: its
// only caller in the monorepo was this describe. See the note where it used to live
// in `src/index.ts`.
