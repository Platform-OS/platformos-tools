import { describe, expect, it } from 'vitest';

import {
  isLayout,
  isPage,
  isPartial,
  path,
  recursiveReadDirectory,
} from '@platformos/platformos-check-common';
import { MockFileSystem, type MockApp } from '@platformos/platformos-check-common/dist/test';

import { enumerateEdgeSources, isEdgeSource } from '../index';

/**
 * TASK-9.17: `enumerateEdgeSources` is the SINGLE canonical "what are the
 * edge-source liquid files under a project root" primitive. The supervisor's
 * GraphCache consumes it for BOTH the fingerprint domain and the build's entry
 * points, so its definition must never silently drift from the file-type
 * classifier (`isLayout`/`isPage`/`isPartial` ← `FILE_TYPE_DIRS`).
 *
 * The load-bearing guard is EQUIVALENCE-TO-THE-CLASSIFIER: the SCOPED walk (only
 * the platformOS source roots, the TASK-9.15 Phase-3A perf win) must gather the
 * exact same set a WHOLE-TREE walk filtered by `isEdgeSource` would. If a new
 * source root / partial location is added to the classifier but not to the
 * scoped roots, the whole-tree walk finds files the scoped walk misses → this
 * test fails, catching the drift before it under-reports dependents.
 */
describe('Unit: enumerateEdgeSources (canonical edge-source enumeration)', () => {
  const rootUri = path.normalize('file:/');
  const uri = (rel: string) => path.join(rootUri, rel);

  // Edge sources under every canonical location a Page/Layout/Partial can live.
  const EDGE_SOURCES = [
    'app/views/pages/home.liquid', // Page (modern app/ root)
    'app/views/layouts/application.liquid', // Layout
    'app/views/partials/card.liquid', // Partial (views/partials)
    'app/lib/helper.liquid', // Partial (lib)
    'marketplace_builder/views/pages/legacy.liquid', // Page (legacy root)
    'modules/shop/public/views/partials/widget.liquid', // Partial (top-level module)
    'app/modules/blog/private/views/pages/post.liquid', // Page (nested app/modules)
  ];

  // Files that are NOT edge sources: leaves, non-liquid, and a bundled
  // non-platformOS sibling that must never be walked.
  const NON_EDGE_SOURCES = {
    'app/graphql/get_posts.graphql': 'query { records { results { id } } }',
    'app/schema/blog_post.yml': 'name: blog_post',
    'app/assets/logo.css': 'body {}',
    'react-app/src/components/Widget.liquid': 'noise that is never a source',
    'README.md': '# project',
  };

  const makeFs = () => {
    const files: MockApp = { ...NON_EDGE_SOURCES };
    for (const rel of EDGE_SOURCES) files[rel] = '<div></div>';
    return new MockFileSystem(files, rootUri);
  };

  const sorted = (uris: string[]) => [...uris].sort();

  it('gathers exactly the edge sources across all source roots (nothing else)', async () => {
    const fs = makeFs();
    expect(sorted(await enumerateEdgeSources(fs, rootUri))).toEqual(sorted(EDGE_SOURCES.map(uri)));
  });

  it('the scoped walk equals a whole-tree walk filtered by the classifier (no drift)', async () => {
    const fs = makeFs();
    const scoped = sorted(await enumerateEdgeSources(fs, rootUri));
    const wholeTree = sorted(await recursiveReadDirectory(fs, rootUri, ([u]) => isEdgeSource(u)));
    expect(scoped).toEqual(wholeTree);
  });

  it('isEdgeSource is exactly isLayout || isPage || isPartial', () => {
    for (const rel of EDGE_SOURCES) {
      const u = uri(rel);
      expect(isEdgeSource(u)).toBe(true);
      expect(isLayout(u) || isPage(u) || isPartial(u)).toBe(true);
    }
    for (const rel of Object.keys(NON_EDGE_SOURCES)) {
      const u = uri(rel);
      expect(isEdgeSource(u)).toBe(false);
      expect(isLayout(u) || isPage(u) || isPartial(u)).toBe(false);
    }
  });

  it('never yields a non-platformOS sibling (a bundled react-app/ is skipped)', async () => {
    const fs = makeFs();
    const result = await enumerateEdgeSources(fs, rootUri);
    expect(result).not.toContain(uri('react-app/src/components/Widget.liquid'));
  });
});
