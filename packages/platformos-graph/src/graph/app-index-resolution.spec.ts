/**
 * The graph resolves `{% render %}` / `{% function %}` / `{% graphql %}` / `layout:`
 * targets through `IDependencies.app`'s index when it is given one.
 *
 * Two things are pinned, and they pull in opposite directions:
 *
 * 1. COST. With an app, a name is answered from the O(1) index and the build lists no
 *    directory at all — except for assets, which never use the index by design.
 * 2. ANSWER. The graph must be IDENTICAL with the app, without it, and with an app whose
 *    index is only partly populated. The index is a shortcut through `findOrLocate`, not
 *    a second resolution rule, so every arm here compares whole graphs.
 *
 * The no-app arm is the control for the cost claim: it shows these very lookups DO cost
 * listings when nothing can answer them, so "no directories listed" is caused by the
 * index rather than by a fixture with nothing to resolve.
 */
import { path as pathUtils } from '@platformos/platformos-check-common';
import {
  AbstractFileSystem,
  App,
  UriString,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildAppGraph } from '../index';
import { AppGraph, AppModule, Reference } from '../types';
import { unique } from '../utils';
import { fixturesRoot, makeGetSourceCode, skeleton } from './test-helpers';

const moduleEdges = pathUtils.join(fixturesRoot, 'module-edges');

/** The real filesystem, with every directory listing recorded. */
function recordingFs(): { fs: AbstractFileSystem; listedDirectories: UriString[] } {
  const listedDirectories: UriString[] = [];
  const fs: AbstractFileSystem = {
    stat: (uri) => NodeFileSystem.stat(uri),
    readFile: (uri) => NodeFileSystem.readFile(uri),
    readDirectory: (uri) => {
      listedDirectories.push(uri);
      return NodeFileSystem.readDirectory(uri);
    },
  };
  return { fs, listedDirectories };
}

/** Every source file under the root, classified — the app the language server holds. */
async function wholeApp(rootUri: UriString, fs: AbstractFileSystem): Promise<App> {
  return App.fromPaths(rootUri, await walkAppSourceFiles(fs, rootUri), fs);
}

/** An app that knows the entry points and nothing else, so every target is an index MISS. */
async function pagesOnlyApp(rootUri: UriString, fs: AbstractFileSystem): Promise<App> {
  const whole = await wholeApp(rootUri, fs);
  return App.fromPaths(
    rootUri,
    whole.pages().map((file) => file.uri),
    fs,
  );
}

interface Build {
  graph: AppGraph;
  /** Distinct directories listed while RESOLVING (the walks that precede it are discarded). */
  listedDirectories: UriString[];
  /** Distinct URIs the build asked for a source code, sorted. */
  sourcesRead: UriString[];
}

/**
 * Build the fixture's graph from its pages and layouts, recording what it touched.
 *
 * `entryPoints` are passed explicitly — a discovering build walks the project first, and
 * those listings would swamp the ones under test. The scope is the same one
 * `buildAppGraph` would have discovered for these fixtures.
 */
async function buildRecording(
  rootUri: UriString,
  makeApp?: (rootUri: UriString, fs: AbstractFileSystem) => Promise<App>,
): Promise<Build> {
  const { fs, listedDirectories } = recordingFs();
  const entryPointsApp = await wholeApp(rootUri, fs);
  const entryPoints = [...entryPointsApp.pages(), ...entryPointsApp.layouts()].map(
    (file) => file.uri,
  );
  const app = makeApp ? await makeApp(rootUri, fs) : undefined;

  const sourcesRead: UriString[] = [];
  const getSourceCode = makeGetSourceCode(fs);

  // Everything above is fixture setup — the walks it performed are not what is measured.
  listedDirectories.length = 0;

  const graph = await buildAppGraph(
    rootUri,
    {
      fs,
      app,
      getSourceCode: (uri) => {
        sourcesRead.push(uri);
        return getSourceCode(uri);
      },
    },
    entryPoints,
  );

  return {
    graph,
    // SORTED, not in call order: entry points are traversed concurrently, so which
    // lookup reaches the filesystem first is a scheduling detail. WHICH directories a
    // build has to list is the claim.
    listedDirectories: unique(listedDirectories).sort(),
    sourcesRead: unique(sourcesRead).sort(),
  };
}

const dir = (rootUri: UriString, relative: string): UriString =>
  pathUtils.join(rootUri, ...relative.split('/'));

const referenceKey = (reference: Reference): string =>
  [
    reference.source.uri,
    reference.source.range?.join(':') ?? '',
    reference.kind,
    reference.type,
  ].join('|');

/**
 * The graph with every node's REVERSE index (`references`) in a stable order.
 *
 * A node's dependents are appended as each caller finishes traversing, and entry points
 * are traversed concurrently — so their order tracks how long each resolution took,
 * which is precisely what an index changes. `dependencies` are deliberately NOT sorted:
 * those come from one file's visit in source order, so a difference there would be a
 * real one and must still fail.
 */
function canonical(graph: AppGraph): AppGraph {
  const sortReferences = (module: AppModule): AppModule => ({
    ...module,
    references: [...module.references].sort((a, b) =>
      referenceKey(a).localeCompare(referenceKey(b)),
    ),
  });

  return {
    ...graph,
    entryPoints: graph.entryPoints.map(sortReferences),
    modules: Object.fromEntries(
      Object.entries(graph.modules).map(([uri, module]) => [uri, sortReferences(module)]),
    ),
  };
}

describe('a graph build over a project with an App index', () => {
  let indexed: Build;
  let unindexed: Build;
  let partialIndex: Build;

  beforeAll(async () => {
    indexed = await buildRecording(skeleton, wholeApp);
    unindexed = await buildRecording(skeleton);
    partialIndex = await buildRecording(skeleton, pagesOnlyApp);
  });

  it('lists no directory but the asset one, because the index answers every name', () => {
    // `app/assets` is here on purpose: `findOrLocate` never indexes an asset, since
    // nothing reads one and the only question is whether it still exists on disk.
    expect(indexed.listedDirectories).toEqual([dir(skeleton, 'app/assets')]);
  });

  it('lists a directory per candidate when there is no index to answer from', () => {
    expect(unindexed.listedDirectories).toEqual([
      dir(skeleton, 'app/assets'),
      dir(skeleton, 'app/views/layouts'),
      dir(skeleton, 'app/views/partials'),
    ]);
  });

  it('builds the same graph with the index as without it', () => {
    expect(canonical(indexed.graph)).toEqual(canonical(unindexed.graph));
  });

  it('falls back to the filesystem for a name the index does not hold', () => {
    expect(canonical(partialIndex.graph)).toEqual(canonical(unindexed.graph));
    // And the miss really was a miss: the partial and layout directories were listed,
    // so the equality above is not an app that quietly answered everything.
    expect(partialIndex.listedDirectories).toEqual(unindexed.listedDirectories);
  });

  it('never asks for an asset source code, only for the files it traverses', () => {
    // An Asset node is a leaf whose only fact is existence (an `fs.stat`), so `app.js`
    // and `app.css` are absent here — which is why an App backing a graph needs no
    // `.js`/image parsers. Every Liquid file in the fixture IS read: the absence above
    // is about assets, not about a build that read nothing.
    expect(indexed.sourcesRead).toEqual(
      [
        pathUtils.join(skeleton, 'app', 'views', 'layouts', 'application.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'pages', 'index.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'child.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'header.liquid'),
        pathUtils.join(skeleton, 'app', 'views', 'partials', 'parent.liquid'),
      ].sort(),
    );
  });
});

describe('a module-prefixed name resolved through an App index', () => {
  let indexed: Build;
  let unindexed: Build;

  beforeAll(async () => {
    indexed = await buildRecording(moduleEdges, wholeApp);
    unindexed = await buildRecording(moduleEdges);
  });

  it('costs no listing at all — this fixture has no assets to except', () => {
    expect(indexed.listedDirectories).toEqual([]);
  });

  it('resolves `modules/my_module/…` to the same files the candidate walk finds', () => {
    expect(canonical(indexed.graph)).toEqual(canonical(unindexed.graph));
  });
});
