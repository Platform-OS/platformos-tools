import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appCheckRun, NodeFileSystem, resetRouteTable } from './index';
import { Tree, Workspace, lintBufferOffenses, makeTempWorkspace } from './test/test-helpers';

/**
 * `MissingPage` needs every page's frontmatter, which is whole-project I/O that lazy
 * parsing cannot touch — check-node used to rebuild that table from disk on every
 * lint run. These tests pin that the process-level table removes the repeat cost
 * without letting it answer from stale state.
 */
describe('shared route table', () => {
  let workspace: Workspace | undefined;
  let reads: string[];
  let stats: string[];
  const originalReadFile = NodeFileSystem.readFile;
  const originalStat = NodeFileSystem.stat;

  beforeEach(() => {
    resetRouteTable();
    reads = [];
    stats = [];
    NodeFileSystem.readFile = (uri: string) => {
      reads.push(uri);
      return originalReadFile(uri);
    };
    NodeFileSystem.stat = (uri: string) => {
      stats.push(uri);
      return originalStat(uri);
    };
  });

  afterEach(async () => {
    NodeFileSystem.readFile = originalReadFile;
    NodeFileSystem.stat = originalStat;
    resetRouteTable();
    await workspace?.clean();
    workspace = undefined;
  });

  const config = ['extends: platformos-check:nothing', 'MissingPage:', '  enabled: true', ''].join(
    '\n',
  );

  function tree(pages: Record<string, string>): Tree {
    return {
      '.platformos-check.yml': config,
      app: { views: { pages } },
    };
  }

  const pageReads = () => reads.filter((uri) => uri.includes('/views/pages/'));
  const pageStats = () => stats.filter((uri) => uri.includes('/views/pages/'));
  const basenames = (uris: string[]) => uris.map((uri) => path.basename(uri)).sort();

  it('touches no page at all when the file under lint links nowhere', async () => {
    workspace = await makeTempWorkspace(
      tree({
        'home.liquid': '<h1>home</h1>',
        'about.liquid': 'about',
        'contact.liquid': 'contact',
      }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '<h1>home</h1><a href="https://example.com">out</a>',
      configPath,
    });

    // Nothing in this buffer resolves a route, so the table is never asked for — no
    // page is read and none is fingerprinted, on the very first call.
    expect(offenses).toEqual([]);
    expect(pageReads()).toEqual([]);
    expect(pageStats()).toEqual([]);
  });

  it('builds the table on the first call that does need a route', async () => {
    workspace = await makeTempWorkspace(
      tree({ 'home.liquid': '<h1>home</h1>', 'about.liquid': 'about' }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const buffer = (content: string) => ({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content,
      configPath,
    });

    expect(await lintBufferOffenses(buffer('<h1>home</h1>'))).toEqual([]);

    // Skipping the build did not leave the process unable to do it later.
    expect(await lintBufferOffenses(buffer('<a href="/about">about</a>'))).toEqual([]);
    expect(basenames(pageReads())).toEqual(['about.liquid']);

    expect(
      (await lintBufferOffenses(buffer('<a href="/ghost">ghost</a>'))).map(
        (offense) => offense.check,
      ),
    ).toEqual(['MissingPage']);
  });

  it('performs zero page reads on a second run over an unchanged project', async () => {
    workspace = await makeTempWorkspace(
      tree({
        'home.liquid': '<a href="/about">about</a>',
        'about.liquid': 'about',
        'contact.liquid': 'contact',
      }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');
    const buffer = {
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '<a href="/about">about</a>',
      configPath,
    };

    // The cold call has to read every page to learn its route — except the buffer,
    // whose content it was handed.
    expect(await lintBufferOffenses(buffer)).toEqual([]);
    expect(
      pageReads()
        .map((uri) => path.basename(uri))
        .sort(),
    ).toEqual(['about.liquid', 'contact.liquid']);

    reads = [];
    const second = await lintBufferOffenses(buffer);

    // The warm call reads no page at all: the two unchanged ones are fingerprinted,
    // and the third is the buffer, whose content is already in memory.
    expect(pageReads()).toEqual([]);
    expect(second).toEqual([]);
  });

  it('reflects a page added on disk without rebuilding the table', async () => {
    workspace = await makeTempWorkspace(
      tree({ 'home.liquid': '<a href="/about">about</a>', 'about.liquid': 'about' }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    await appCheckRun(root, configPath);
    await fs.writeFile(path.join(root, 'app/views/pages/extra.liquid'), 'extra', 'utf8');

    reads = [];
    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '<a href="/extra">extra</a>',
      configPath,
    });

    expect(offenses).toEqual([]);
    // Only the new page had to be read; the other two were unchanged.
    expect(pageReads().map((uri) => path.basename(uri))).toEqual(['extra.liquid']);
  });

  it('reflects a page deleted on disk', async () => {
    workspace = await makeTempWorkspace(
      tree({ 'home.liquid': '<a href="/about">about</a>', 'about.liquid': 'about' }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    expect((await appCheckRun(root, configPath)).offenses).toEqual([]);

    await fs.rm(path.join(root, 'app/views/pages/about.liquid'));

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '<a href="/about">about</a>',
      configPath,
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['MissingPage']);
  });

  it("reflects a page's slug changing on disk", async () => {
    workspace = await makeTempWorkspace(
      tree({
        'home.liquid': '<a href="/about">about</a>',
        'about.liquid': '---\nslug: about\n---\nabout',
      }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    expect((await appCheckRun(root, configPath)).offenses).toEqual([]);

    // Rewriting the frontmatter moves the route. A same-length edit would defeat a
    // size-only fingerprint, so the mtime has to be part of it.
    await fs.writeFile(
      path.join(root, 'app/views/pages/about.liquid'),
      '---\nslug: elsewhere\n---\nabout',
      'utf8',
    );

    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/home.liquid'),
      content: '<a href="/about">about</a>',
      configPath,
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['MissingPage']);
  });

  it("resolves an unsaved page's own route from the buffer, not from disk", async () => {
    workspace = await makeTempWorkspace(
      tree({
        'home.liquid': 'home',
        'target.liquid': '---\nslug: on-disk\n---\ntarget',
      }),
    );
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    // The buffer moves this page's own route, and links to where it is going.
    const offenses = await lintBufferOffenses({
      root,
      filePath: path.join(root, 'app/views/pages/target.liquid'),
      content: '---\nslug: in-buffer\n---\n<a href="/in-buffer">self</a>',
      configPath,
    });

    expect(offenses).toEqual([]);
  });

  it('does not serve routes from a previous project after the root changes', async () => {
    const first = await makeTempWorkspace(tree({ 'home.liquid': 'home', 'about.liquid': 'about' }));
    const second = await makeTempWorkspace(tree({ 'home.liquid': 'home' }));

    try {
      expect(
        (await appCheckRun(first.root, path.join(first.root, '.platformos-check.yml'))).offenses,
      ).toEqual([]);

      const offenses = await lintBufferOffenses({
        root: second.root,
        filePath: path.join(second.root, 'app/views/pages/home.liquid'),
        content: '<a href="/about">about</a>',
        configPath: path.join(second.root, '.platformos-check.yml'),
      });

      // `/about` exists only in the first project.
      expect(offenses.map((offense) => offense.check)).toEqual(['MissingPage']);
    } finally {
      await first.clean();
      await second.clean();
    }
  });

  it('produces the same MissingPage results as a run with no shared table', async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': config,
      app: {
        views: {
          pages: {
            'home.liquid': [
              '<a href="/about">about</a>',
              '<a href="/api/data.json">json</a>',
              '<a href="/ghost">ghost</a>',
            ].join('\n'),
            'about.liquid': '---\nslug: about\n---\nabout',
            'data.json.liquid': '---\nslug: api/data\nformat: json\n---\n{}',
          },
        },
      },
      modules: {
        admin: {
          public: {
            views: { pages: { 'dashboard.liquid': '---\nslug: admin/dashboard\n---\nx' } },
          },
        },
      },
    });
    const root = workspace.root;
    const configPath = path.join(root, '.platformos-check.yml');

    const fresh = await appCheckRun(root, configPath);
    resetRouteTable();
    const alsoFresh = await appCheckRun(root, configPath);
    const warm = await appCheckRun(root, configPath);

    const messages = (offenses: { check: string; message: string }[]) =>
      offenses.map((offense) => `${offense.check}: ${offense.message}`).sort();

    expect(messages(warm.offenses)).toEqual(messages(fresh.offenses));
    expect(messages(alsoFresh.offenses)).toEqual(messages(fresh.offenses));
    expect(messages(fresh.offenses)).toEqual([
      "MissingPage: No page found for route '/ghost' (GET)",
    ]);
  });
});
