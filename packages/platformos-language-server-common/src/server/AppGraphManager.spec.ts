/**
 * The graph this server builds resolves names through the `App` this server already
 * holds — the same object it reads sources through.
 */
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { AbstractFileSystem, UriString } from '@platformos/platformos-common';
import { describe, expect, it, vi } from 'vitest';
import { Connection } from 'vscode-languageserver';

import { DocumentManager } from '../documents';
import { AppGraph } from '@platformos/platformos-graph';
import { AppGraphManager } from './AppGraphManager';

const rootUri = 'file:///project';
const pageUri = `${rootUri}/app/views/pages/index.liquid`;

async function buildThroughManager(files: Record<string, string>): Promise<{
  graph: AppGraph;
  /** Distinct directories listed while BUILDING, sorted; the preload walk is excluded. */
  listedDirectories: UriString[];
}> {
  const listed: UriString[] = [];
  const mockFs = new MockFileSystem(files, rootUri);
  const fs: AbstractFileSystem = {
    readFile: (uri) => mockFs.readFile(uri),
    stat: (uri) => mockFs.stat(uri),
    readDirectory: (uri) => {
      listed.push(uri);
      return mockFs.readDirectory(uri);
    },
  };

  const documentManager = new DocumentManager(fs);
  const manager = new AppGraphManager(
    { sendNotification: vi.fn() } as unknown as Connection,
    documentManager,
    fs,
    async () => rootUri,
  );

  // Preloaded HERE rather than left to the build: `preload` is memoized, so the build's
  // own call is a no-op, and its project walk is not what this measures.
  await documentManager.preload(rootUri);
  listed.length = 0;

  const graph = await manager.getAppGraphForURI(pageUri);
  if (!graph) throw new Error('no graph was built for the project root');

  return { graph, listedDirectories: [...new Set(listed)].sort() };
}

describe('AppGraphManager name resolution', () => {
  it('resolves a render target from the app index, listing no directory at all', async () => {
    const { graph, listedDirectories } = await buildThroughManager({
      'app/views/pages/index.liquid': `{% render 'card' %}`,
      'app/views/partials/card.liquid': `<article>card</article>`,
    });

    expect(listedDirectories).toEqual([]);
    // The partial really was resolved and traversed — a build that resolved nothing
    // would also have listed nothing.
    expect(Object.keys(graph.modules).sort()).toEqual([
      `${rootUri}/app/views/pages/index.liquid`,
      `${rootUri}/app/views/partials/card.liquid`,
    ]);
  });

  it('still walks the candidate directories for a target the app does not hold', async () => {
    const { graph, listedDirectories } = await buildThroughManager({
      'app/views/pages/index.liquid': `{% render 'nope' %}`,
    });

    // Both directories a partial name can live in (`getAppPaths(Partial)`), listed once
    // each: every format spelling of a name shares a parent, so the miss path costs one
    // listing per candidate DIRECTORY rather than a `stat` per spelling.
    expect(listedDirectories).toEqual([`${rootUri}/app/lib`, `${rootUri}/app/views/partials`]);
    // The unresolvable target is still a node, marked absent — that is how the graph
    // reports a broken reference.
    expect(graph.modules[`${rootUri}/app/views/partials/nope.liquid`]?.exists).toBe(false);
  });
});
