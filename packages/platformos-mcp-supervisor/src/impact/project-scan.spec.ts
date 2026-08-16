import { describe, expect, it } from 'vitest';

import type { UriString } from '@platformos/platformos-check-common';
import { FileType, type AbstractFileSystem, type FileTuple } from '@platformos/platformos-common';

import { createProjectScan } from './project-scan.js';

const ROOT: UriString = 'file:///project';

/**
 * A filesystem over a `relative path → contents` tree that COUNTS its reads, which
 * is the whole point: the scan's contract is what it costs, not just what it
 * returns.
 */
function countingFs(tree: Record<string, string>) {
  const reads: string[] = [];
  const paths = Object.keys(tree);

  const fs: AbstractFileSystem = {
    async readFile(uri: string) {
      reads.push(uri);
      const contents = tree[uri.slice(`${ROOT}/`.length)];
      if (contents === undefined) throw new Error(`no such file: ${uri}`);
      return contents;
    },
    async readDirectory(uri: string): Promise<FileTuple[]> {
      const prefix = uri === ROOT ? '' : `${uri.slice(`${ROOT}/`.length)}/`;
      const entries = new Map<string, FileType>();
      for (const filePath of paths) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const cut = rest.indexOf('/');
        entries.set(
          cut === -1 ? rest : rest.slice(0, cut),
          cut === -1 ? FileType.File : FileType.Directory,
        );
      }
      if (entries.size === 0) throw new Error(`no such directory: ${uri}`);
      return [...entries].map(([name, type]) => [`${uri}/${name}`, type] as FileTuple);
    },
    async stat(uri: string) {
      const contents = tree[uri.slice(`${ROOT}/`.length)];
      if (contents === undefined) throw new Error(`no such file: ${uri}`);
      return { type: FileType.File, size: contents.length };
    },
  };

  return { fs, reads };
}

const PROJECT = {
  'app/views/pages/index.liquid': "{% render 'card' %}",
  'app/views/partials/card.liquid': '<div></div>',
  'app/graphql/get_posts.graphql': 'query { posts { id } }',
};

describe('createProjectScan', () => {
  it('reads every edge source, and nothing that cannot declare an edge', async () => {
    const { fs } = countingFs(PROJECT);

    const sources = await createProjectScan(ROOT, fs).sources();

    // The `.graphql` operation is a LEAF: it can be referenced but can never
    // reference, so reading it would be pure cost.
    expect([...sources.keys()].sort()).toEqual([
      'file:///project/app/views/pages/index.liquid',
      'file:///project/app/views/partials/card.liquid',
    ]);
  });

  it('reads the project ONCE however many times it is asked', async () => {
    const { fs, reads } = countingFs(PROJECT);
    const scan = createProjectScan(ROOT, fs);

    const [first, second, third] = await Promise.all([
      scan.sources(),
      scan.sources(),
      scan.sources(),
    ]);

    // Same object back, and two liquid files read in total — not six.
    expect([first === second, second === third]).toEqual([true, true]);
    expect(reads.sort()).toEqual([
      'file:///project/app/views/pages/index.liquid',
      'file:///project/app/views/partials/card.liquid',
    ]);
  });

  it('reads nothing at all until it is asked', async () => {
    const { fs, reads } = countingFs(PROJECT);

    createProjectScan(ROOT, fs);

    expect(reads).toEqual([]);
  });

  it('serves a buffer instead of the file on disk, without reading that file', async () => {
    const { fs, reads } = countingFs(PROJECT);
    const page: UriString = 'file:///project/app/views/pages/index.liquid';

    const sources = await createProjectScan(
      ROOT,
      fs,
      new Map([[page, "{% render 'other' %}"]]),
    ).sources();

    expect(sources.get(page)).toEqual("{% render 'other' %}");
    expect(reads).toEqual(['file:///project/app/views/partials/card.liquid']);
  });

  it('includes a buffer for a file that is not on disk yet', async () => {
    const { fs } = countingFs(PROJECT);
    const fresh: UriString = 'file:///project/app/views/pages/brand-new.liquid';

    const sources = await createProjectScan(ROOT, fs, new Map([[fresh, "{% render 'card' %}"]]))
      .sources()
      .then((all) => all);

    expect(sources.get(fresh)).toEqual("{% render 'card' %}");
  });

  it('drops a buffer that could never declare an edge, rather than scanning it', async () => {
    const { fs } = countingFs(PROJECT);
    const operation: UriString = 'file:///project/app/graphql/get_posts.graphql';

    const sources = await createProjectScan(
      ROOT,
      fs,
      new Map([[operation, 'query { posts { id title } }']]),
    ).sources();

    expect(sources.has(operation)).toBe(false);
  });

  /**
   * A file the walk saw and the read could not open is the ordinary race (it was
   * deleted in between), not a reason to lose the whole answer.
   *
   * The control is `index.liquid`: the same scan still returns it, so "card is
   * missing" cannot be the scan having failed wholesale.
   */
  it('skips a file that vanished between the walk and the read, keeping the rest', async () => {
    const { fs } = countingFs(PROJECT);
    const vanishing = 'file:///project/app/views/partials/card.liquid';
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (uri: string) => {
      if (uri === vanishing) throw new Error('ENOENT');
      return readFile(uri);
    };

    const sources = await createProjectScan(ROOT, fs).sources();

    expect([...sources.keys()]).toEqual(['file:///project/app/views/pages/index.liquid']);
  });
});
