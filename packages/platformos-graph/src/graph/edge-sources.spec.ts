import { describe, expect, it } from 'vitest';

import { path } from '@platformos/platformos-check-common';
import { FileType, getFileType, PlatformOSFileType } from '@platformos/platformos-common';
import type { AbstractFileSystem, UriString } from '@platformos/platformos-common';
import { MockFileSystem, type MockApp } from '@platformos/platformos-check-common/dist/test';

import { enumerateEdgeSources, isEdgeSource } from '../index';

/**
 * `enumerateEdgeSources` is the SINGLE canonical "what are the
 * edge-source liquid files under a project root" primitive. The supervisor's
 * GraphCache consumes it for BOTH the fingerprint domain and the build's entry
 * points, so its definition must never silently drift from the file-type
 * classifier (`getFileType` ← `FILE_TYPE_DIRS`).
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
    'modules/shop/public/views/partials/widget.liquid', // Partial (top-level module, public)
    'modules/shop/private/lib/secret.liquid', // Partial (top-level module, PRIVATE access level)
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
    const wholeTree = sorted(
      (await everyFileUnder(fs, rootUri)).filter((u) => isEdgeSource(u, rootUri)),
    );
    expect(scoped).toEqual(wholeTree);
  });

  it('isEdgeSource is exactly the Layout/Page/Partial classification', () => {
    const EDGE_SOURCE_TYPES = [
      PlatformOSFileType.Layout,
      PlatformOSFileType.Page,
      PlatformOSFileType.Partial,
    ];
    for (const rel of EDGE_SOURCES) {
      const u = uri(rel);
      expect(isEdgeSource(u, rootUri)).toBe(true);
      expect(EDGE_SOURCE_TYPES).toContain(getFileType(u, rootUri));
    }
    for (const rel of Object.keys(NON_EDGE_SOURCES)) {
      const u = uri(rel);
      expect(isEdgeSource(u, rootUri)).toBe(false);
      expect(EDGE_SOURCE_TYPES).not.toContain(getFileType(u, rootUri));
    }
  });

  /**
   * The reason the classification is anchored on the root. Unanchored, a directory
   * named like a platformOS one ANYWHERE in the path classified: these three files
   * are not part of the app, and counting them in the fingerprint domain made the
   * supervisor's GraphCache rebuild on edits to files the app never reads.
   */
  it('does not admit a platformOS-looking path outside the app subtrees', async () => {
    const outside = {
      'tmp/app/views/partials/scratch.liquid': '<div></div>',
      'seed/post_import/app/views/pages/fixture.liquid': '<div></div>',
      'node_modules/pkg/app/lib/helper.liquid': '<div></div>',
    };
    for (const rel of Object.keys(outside)) expect(isEdgeSource(uri(rel), rootUri)).toBe(false);

    // Control: the same three spellings ARE found when they sit at the real root, so
    // the silence above is the anchoring, not the fixture or the walk.
    const files: MockApp = { ...outside };
    for (const rel of EDGE_SOURCES) files[rel] = '<div></div>';
    const fs = new MockFileSystem(files, rootUri);
    expect(sorted(await enumerateEdgeSources(fs, rootUri))).toEqual(sorted(EDGE_SOURCES.map(uri)));
  });

  it('never yields a non-platformOS sibling (a bundled react-app/ is skipped)', async () => {
    const fs = makeFs();
    const result = await enumerateEdgeSources(fs, rootUri);
    expect(result).not.toContain(uri('react-app/src/components/Widget.liquid'));
  });
});

/**
 * Every file under `baseUri`, by brute-force recursion into every directory.
 */
async function everyFileUnder(fs: AbstractFileSystem, baseUri: UriString): Promise<UriString[]> {
  const entries = await fs.readDirectory(baseUri).catch(() => []);

  const nested = await Promise.all(
    entries.map(async ([uri, type]) =>
      type === FileType.Directory ? everyFileUnder(fs, uri) : [uri],
    ),
  );

  return nested.flat();
}
