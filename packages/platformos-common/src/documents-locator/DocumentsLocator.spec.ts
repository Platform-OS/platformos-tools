import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { DocumentsLocator, DocumentType, loadSearchPaths } from './DocumentsLocator';
import { AbstractFileSystem, FileType, FileStat, FileTuple } from '../AbstractFileSystem';
import { App } from '../app';
import { PlatformOSFileType } from '../path-utils';

function createMockFileSystem(files: Record<string, string>): AbstractFileSystem {
  /**
   * Derived per call rather than snapshotted at construction, so a test can add or
   * remove a file mid-run. That is the only way to observe a cache serving an answer
   * the filesystem no longer supports — snapshot it and every staleness test passes
   * whatever the cache does.
   */
  function tree() {
    const fileSet = new Set(Object.keys(files));
    const dirs = new Set<string>();
    for (const filePath of fileSet) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return { fileSet, dirs };
  }

  return {
    stat: vi.fn(async (uri: string): Promise<FileStat> => {
      const { fileSet, dirs } = tree();
      if (fileSet.has(uri)) {
        return { type: FileType.File, size: files[uri].length };
      }
      if (dirs.has(uri)) {
        return { type: FileType.Directory, size: 0 };
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readFile: vi.fn(async (uri: string): Promise<string> => {
      if (tree().fileSet.has(uri)) {
        return files[uri];
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readDirectory: vi.fn(async (uri: string): Promise<FileTuple[]> => {
      const { fileSet, dirs } = tree();
      const results: FileTuple[] = [];
      const seen = new Set<string>();
      const prefix = uri.endsWith('/') ? uri : uri + '/';

      for (const path of [...fileSet, ...dirs]) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const firstSegment = rest.split('/')[0];
        if (!firstSegment || seen.has(firstSegment)) continue;
        seen.add(firstSegment);

        const fullPath = prefix + firstSegment;
        const isDir = dirs.has(fullPath) && !fileSet.has(fullPath);
        results.push([fullPath, isDir ? FileType.Directory : FileType.File]);
      }
      return results;
    }),
  };
}

describe('DocumentsLocator', () => {
  const rootUri = URI.parse('file:///project');

  describe('locateDefault', () => {
    it('render → app/views/partials', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'render', 'my/partial')).toBe(
        'file:///project/app/views/partials/my/partial.liquid',
      );
    });

    it('include → app/views/partials', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'include', 'card')).toBe(
        'file:///project/app/views/partials/card.liquid',
      );
    });

    it('function → app/lib', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'function', 'commands/apply')).toBe(
        'file:///project/app/lib/commands/apply.liquid',
      );
    });

    it('background → app/views/partials', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'background', 'mytest/inner')).toBe(
        'file:///project/app/views/partials/mytest/inner.liquid',
      );
    });

    it('graphql → app/graphql', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'graphql', 'users/search')).toBe(
        'file:///project/app/graphql/users/search.graphql',
      );
    });

    it('theme_render_rc → undefined', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'theme_render_rc', 'card')).toBeUndefined();
    });

    it('module render → modules/.../public/views/partials', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'render', 'modules/core/my/partial')).toBe(
        'file:///project/modules/core/public/views/partials/my/partial.liquid',
      );
    });

    it('module function → modules/.../public/lib', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'function', 'modules/core/commands/apply')).toBe(
        'file:///project/modules/core/public/lib/commands/apply.liquid',
      );
    });

    it('module graphql → modules/.../public/graphql', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'graphql', 'modules/core/users/search')).toBe(
        'file:///project/modules/core/public/graphql/users/search.graphql',
      );
    });

    it('deeply nested path — creates all missing intermediate dirs', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'render', 'a/b/c/d/partial')).toBe(
        'file:///project/app/views/partials/a/b/c/d/partial.liquid',
      );
    });

    it('asset → app/assets (canonical location; the reference carries its own extension)', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'asset', 'emails/logo.png')).toBe(
        'file:///project/app/assets/emails/logo.png',
      );
    });

    it('module asset → modules/.../public/assets', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'asset', 'modules/core/logo.png')).toBe(
        'file:///project/modules/core/public/assets/logo.png',
      );
    });
    it('layout → app/views/layouts (.liquid canonical default)', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'layout', 'theme')).toBe(
        'file:///project/app/views/layouts/theme.liquid',
      );
    });

    it('module layout → modules/.../public/views/layouts', () => {
      const locator = new DocumentsLocator(createMockFileSystem({}));
      expect(locator.locateDefault(rootUri, 'layout', 'modules/core/admin')).toBe(
        'file:///project/modules/core/public/views/layouts/admin.liquid',
      );
    });
  });

  describe('locate', () => {
    it('should locate a partial file in app/lib', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/lib/my-partial.liquid': '{% comment %}partial{% endcomment %}',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'function', 'my-partial');

      expect(result).toBe('file:///project/app/lib/my-partial.liquid');
    });

    it('should locate a view file in app/views/partials', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/product-card.liquid': '<div>product</div>',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'render', 'product-card');

      expect(result).toBe('file:///project/app/views/partials/product-card.liquid');
    });

    it('should locate a module partial in app/modules path', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/user/public/lib/helper.liquid':
          '{% comment %}helper{% endcomment %}',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'function', 'modules/user/helper');

      expect(result).toBe('file:///project/app/modules/user/public/lib/helper.liquid');
    });

    it('should locate a graphql file in app/graphql', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/graphql/users/get.graphql': 'query getUsers { users { id } }',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'graphql', 'users/get');

      expect(result).toBe('file:///project/app/graphql/users/get.graphql');
    });

    it('should return undefined for non-existent file', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'function', 'non-existent');

      expect(result).toBeUndefined();
    });

    it('should check private module paths when public does not exist', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/admin/private/views/partials/secret.liquid':
          '<div>secret</div>',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'render', 'modules/admin/secret');

      expect(result).toBe('file:///project/app/modules/admin/private/views/partials/secret.liquid');
    });

    it('should locate a .liquid layout in app/views/layouts', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/application.liquid': '{{ content_for_layout }}',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'application');

      expect(result).toBe('file:///project/app/views/layouts/application.liquid');
    });

    it('should locate an .html.liquid layout in app/views/layouts', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/application.html.liquid': '{{ content_for_layout }}',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'application');

      expect(result).toBe('file:///project/app/views/layouts/application.html.liquid');
    });

    it('resolves a layout deterministically when BOTH spellings exist, which the platform treats as one view', async () => {
      // THIS TEST USED TO ASSERT A PRECEDENCE THE PLATFORM DOES NOT DEFINE. It required
      // `.html.liquid` to win over `.liquid`, which read like a platform rule and is not one.
      //
      // Measured in the platform source (`desksnearme`):
      //   - `LiquidViewConverter.build_default_values` defaults `format` to `'html'`, so a
      //     bare `application.liquid` is an `html` view just like `application.html.liquid`;
      //   - `LiquidPathParser#parse` strips the format extension
      //     (`path.basename(".#{format}")`), so BOTH files produce
      //     `path: 'views/layouts/application'`.
      // The two spellings are therefore the SAME `InstanceView` identity — a project holding
      // both is in an ambiguous state, not one with a documented winner. (Worth its own check;
      // this resolver is not the place to invent an answer.)
      //
      // So what is actually pinned here is what a resolver owes its callers regardless:
      // a deterministic answer, and one of the two real files rather than a third path or
      // `undefined`. Which one is `formatRank`'s business, asserted where that rule lives.
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/application.html.liquid': 'html',
        'file:///project/app/views/layouts/application.liquid': 'plain',
      });
      const locator = new DocumentsLocator(fs);

      const first = await locator.locate(rootUri, 'layout', 'application');
      const again = await locator.locate(rootUri, 'layout', 'application');

      expect([
        'file:///project/app/views/layouts/application.liquid',
        'file:///project/app/views/layouts/application.html.liquid',
      ]).toContain(first);
      expect(again).toBe(first);
    });

    it('resolves a layout that exists ONLY as the legacy .html.liquid', async () => {
      // The control, and the case that actually occurs: arabbank ships
      // `application.html.liquid` with no `application.liquid` beside it. A resolver that
      // only knew `.liquid` would report every page's layout missing.
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/application.html.liquid': 'html',
      });
      const locator = new DocumentsLocator(fs);

      expect(await locator.locate(rootUri, 'layout', 'application')).toBe(
        'file:///project/app/views/layouts/application.html.liquid',
      );
      // ...and a name with no file behind it still fails, so the above is not permissiveness.
      expect(await locator.locate(rootUri, 'layout', 'no_such_layout')).toBeUndefined();
    });

    it('should locate a module layout', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/core/public/views/layouts/admin.liquid': 'admin',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'modules/core/admin');

      expect(result).toBe('file:///project/app/modules/core/public/views/layouts/admin.liquid');
    });

    it('should return undefined for a non-existent layout', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'missing');

      expect(result).toBeUndefined();
    });

    it('should locate a module .html.liquid layout', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/core/public/views/layouts/admin.html.liquid': 'admin',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'modules/core/admin');

      expect(result).toBe(
        'file:///project/app/modules/core/public/views/layouts/admin.html.liquid',
      );
    });

    it('should find a layout in a private module path when public is absent', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/core/private/views/layouts/admin.liquid': 'admin',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'modules/core/admin');

      expect(result).toBe('file:///project/app/modules/core/private/views/layouts/admin.liquid');
    });

    it('should locate a nested layout name', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/admin/dashboard.liquid': 'dash',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'admin/dashboard');

      expect(result).toBe('file:///project/app/views/layouts/admin/dashboard.liquid');
    });

    it('should NOT resolve a layout name that only exists as a partial (search paths are isolated)', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/foo.liquid': 'partial',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'layout', 'foo');

      expect(result).toBeUndefined();
    });

    it('locateOrDefault returns the existing layout (locate short-circuits the default)', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/layouts/theme.html.liquid': 'html',
      });
      const locator = new DocumentsLocator(fs);

      // The default would be `theme.liquid`; the existing `.html.liquid` must win.
      const result = await locator.locateOrDefault(rootUri, 'layout', 'theme');

      expect(result).toBe('file:///project/app/views/layouts/theme.html.liquid');
    });

    it('locateOrDefault falls back to the canonical default for a missing layout', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateOrDefault(rootUri, 'layout', 'theme');

      expect(result).toBe('file:///project/app/views/layouts/theme.liquid');
    });

    it('locateOrDefault returns the existing asset under app/assets', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/assets/emails/logo.png': 'binary',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateOrDefault(rootUri, 'asset', 'emails/logo.png');

      expect(result).toBe('file:///project/app/assets/emails/logo.png');
    });

    it('locateOrDefault falls back to the canonical app/assets path for a missing asset', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateOrDefault(rootUri, 'asset', 'images/missing.png');

      expect(result).toBe('file:///project/app/assets/images/missing.png');
    });

    it('should locate an asset by its own extension (no extension appended)', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/assets/logo.png': 'binary',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locate(rootUri, 'asset', 'logo.png');

      expect(result).toBe('file:///project/app/assets/logo.png');
    });
  });

  describe('list', () => {
    it('should list partial files matching a prefix', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/lib/commands/create.liquid': '',
        'file:///project/app/lib/commands/update.liquid': '',
        'file:///project/app/lib/commands/delete.liquid': '',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.list(rootUri, 'function', 'commands/');

      expect(result).toEqual(['create', 'delete', 'update']);
    });

    it('should list module files with prefix', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/user/public/views/partials/profile.liquid': '',
        'file:///project/app/modules/user/public/views/partials/settings.liquid': '',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.list(rootUri, 'render', 'modules/user/');

      expect(result).toEqual(['profile', 'settings']);
    });

    it('should return empty array for unknown node type', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.list(rootUri, 'unknown', 'test');

      expect(result).toEqual([]);
    });
  });

  describe('locateWithSearchPaths', () => {
    it('should find partial via first search path', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/dress/card.liquid': 'dress',
        'file:///project/app/views/partials/theme/simple/card.liquid': 'simple',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', [
        'theme/dress',
        'theme/simple',
      ]);

      expect(result).toBe('file:///project/app/views/partials/theme/dress/card.liquid');
    });

    it('should fall through to second search path', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/simple/card.liquid': 'simple',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', [
        'theme/dress',
        'theme/simple',
      ]);

      expect(result).toBe('file:///project/app/views/partials/theme/simple/card.liquid');
    });

    it('should fallback to unprefixed path when no search path matches', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/card.liquid': 'default',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', [
        'theme/dress',
        'theme/simple',
      ]);

      expect(result).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should not fallback when empty string is in search paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/card.liquid': 'default',
      });
      const locator = new DocumentsLocator(fs);

      // '' is at position 0, so it tries default path first, finds it
      const result = await locator.locateWithSearchPaths(rootUri, 'card', ['', 'theme/dress']);
      expect(result).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should return undefined when nothing matches', async () => {
      const fs = createMockFileSystem({});
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', ['theme/dress']);
      expect(result).toBeUndefined();
    });

    it('should handle nested partial names with search paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/dress/components/hero.liquid': 'hero',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'components/hero', [
        'theme/dress',
      ]);

      expect(result).toBe('file:///project/app/views/partials/theme/dress/components/hero.liquid');
    });

    it('should also search app/lib with search paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/lib/theme/dress/helper.liquid': 'helper',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'helper', ['theme/dress']);

      expect(result).toBe('file:///project/app/lib/theme/dress/helper.liquid');
    });

    it('should expand dynamic Liquid expressions as wildcards', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/custom/card.liquid': 'custom card',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', [
        'theme/{{ context.constants.THEME }}',
      ]);

      expect(result).toBe('file:///project/app/views/partials/theme/custom/card.liquid');
    });

    it('should expand multiple wildcards in a single path', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/acme/premium/card.liquid': 'card',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'card', [
        '{{ context.constants.BRAND }}/{{ context.constants.TIER }}',
      ]);

      expect(result).toBe('file:///project/app/views/partials/acme/premium/card.liquid');
    });

    it('should return undefined when wildcard expands but partial not found', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/custom/other.liquid': 'other',
      });
      const locator = new DocumentsLocator(fs);

      const result = await locator.locateWithSearchPaths(rootUri, 'missing', [
        'theme/{{ context.constants.THEME }}',
      ]);

      // Fallback to unprefixed — also not found
      expect(result).toBeUndefined();
    });

    it('should cache expanded paths across calls', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/custom/a.liquid': 'a',
        'file:///project/app/views/partials/theme/custom/b.liquid': 'b',
      });
      const locator = new DocumentsLocator(fs);
      const searchPaths = ['theme/{{ x }}'];

      await locator.locateWithSearchPaths(rootUri, 'a', searchPaths);
      const readDirSpy = fs.readDirectory as ReturnType<typeof vi.fn>;
      const callCountAfterFirst = readDirSpy.mock.calls.length;

      await locator.locateWithSearchPaths(rootUri, 'b', searchPaths);
      // Expansion lists the directory AT the wildcard position (`…/theme` under
      // each partial search path) to enumerate its subdirectories; resolution
      // lists the candidate file's parent (`…/theme/custom`). Only the former is
      // cached expansion work, and none of it may repeat on the second call.
      const expansionDirs = [
        'file:///project/app/views/partials/theme',
        'file:///project/app/lib/theme',
      ];
      const expansionCallsAfterFirst = readDirSpy.mock.calls
        .slice(callCountAfterFirst)
        .filter((call: string[]) => expansionDirs.includes(call[0]));
      expect(expansionCallsAfterFirst).toEqual([]);
    });

    /**
     * The three answers a caller gets when a theme directory is replaced: the cached
     * expansion still names the directory that is gone, and clearing is what recovers.
     *
     * The middle assertion is the point. This test asserted only that clearing the cache
     * left the answer unchanged on an UNCHANGED tree, which passes with
     * `clearExpandedPathsCache` reduced to an empty body — it could not tell a working
     * invalidation from no invalidation at all. Whoever holds this locator for longer
     * than one file (the language server) has to call it on a created or deleted file, and
     * `server/startServer.spec.ts` is where that duty is pinned.
     */
    it('serves the stale expansion until the cache is cleared', async () => {
      const files: Record<string, string> = {
        'file:///project/app/views/partials/theme/v1/card.liquid': 'v1',
      };
      const locator = new DocumentsLocator(createMockFileSystem(files));
      const searchPaths = ['theme/{{ version }}'];

      const before = await locator.locateWithSearchPaths(rootUri, 'card', searchPaths);

      delete files['file:///project/app/views/partials/theme/v1/card.liquid'];
      files['file:///project/app/views/partials/theme/v2/card.liquid'] = 'v2';
      const afterNewDirectory = await locator.locateWithSearchPaths(rootUri, 'card', searchPaths);

      locator.clearExpandedPathsCache();
      const afterClearing = await locator.locateWithSearchPaths(rootUri, 'card', searchPaths);

      expect({ before, afterNewDirectory, afterClearing }).toEqual({
        before: 'file:///project/app/views/partials/theme/v1/card.liquid',
        afterNewDirectory: undefined,
        afterClearing: 'file:///project/app/views/partials/theme/v2/card.liquid',
      });
    });

    it('should handle module-prefixed partials with search paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/shop/public/views/partials/card.liquid': 'module card',
      });
      const locator = new DocumentsLocator(fs);

      // module path in fallback (search paths don't apply to module prefix)
      const result = await locator.locateWithSearchPaths(rootUri, 'modules/shop/card', [
        'theme/dress',
      ]);

      expect(result).toBe('file:///project/app/modules/shop/public/views/partials/card.liquid');
    });
  });

  describe('loadSearchPaths', () => {
    it('should load valid theme_search_paths from config', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': `theme_search_paths:
  - theme/dress
  - theme/simple`,
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual(['theme/dress', 'theme/simple']);
    });

    it('should return null when config file does not exist', async () => {
      const fs = createMockFileSystem({});

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toBeNull();
    });

    it('should return null for empty array', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': 'theme_search_paths: []',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toBeNull();
    });

    it('should return null when theme_search_paths is not an array', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': 'theme_search_paths: some_string',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toBeNull();
    });

    it('should return null when config has no theme_search_paths key', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': 'some_other_key: value',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toBeNull();
    });

    it('should coerce non-string entries to strings', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': `theme_search_paths:
  - 123
  - true
  - null`,
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual(['123', 'true', 'null']);
    });

    it('should handle config with Liquid expressions in paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': `theme_search_paths:
  - "theme/{{ context.constants.MY_THEME | default: 'custom' }}"
  - theme/simple`,
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual([
        "theme/{{ context.constants.MY_THEME | default: 'custom' }}",
        'theme/simple',
      ]);
    });

    it('should handle malformed YAML gracefully', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': '{{invalid yaml',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toBeNull();
    });

    it('should handle config with other properties alongside theme_search_paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml': `some_setting: true
theme_search_paths:
  - theme/dress
another_setting: 42`,
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual(['theme/dress']);
    });
  });
});

/**
 * Every reference kind must have an answer, and adding one must be impossible to do
 * halfway.
 *
 * This replaces a pair of `switch`es that were exhaustive over `DocumentType` AND
 * carried a `default: return undefined`. That combination is the worst of both: the
 * default looks like dead code, so it invites deletion, while actually being the thing
 * that stops a NEW `DocumentType` from silently resolving to nothing — a switch with a
 * default never fails to compile when a union member is added.
 *
 * The exhaustiveness now lives in two `Record<DocumentType, …>` tables, which do fail to
 * compile, and the runtime fallback is an explicit `isDocumentType` check that exists
 * for a reason the types cannot express (see below).
 */
describe('DocumentsLocator: every DocumentType is accounted for', () => {
  const rootUri = URI.parse('file:///project');

  const emptyFs: AbstractFileSystem = {
    stat: async () => {
      throw new Error('not found');
    },
    readFile: async () => {
      throw new Error('not found');
    },
    readDirectory: async () => [],
  };

  /**
   * Listed here rather than derived from the source, deliberately: a list generated from
   * the same table it checks would agree with itself by construction. This is the
   * independent copy, and the test below fails if the two ever diverge.
   */
  const ALL_DOCUMENT_TYPES: DocumentType[] = [
    'function',
    'render',
    'include',
    'background',
    'graphql',
    'asset',
    'layout',
    'theme_render_rc',
  ];

  it('the hand-listed DocumentTypes are exactly the ones the union declares', async () => {
    const source = await readFile(join(__dirname, 'DocumentsLocator.ts'), 'utf8');
    const union = source.slice(
      source.indexOf('export type DocumentType ='),
      source.indexOf(';', source.indexOf('export type DocumentType =')),
    );

    const declared = [...union.matchAll(/'([a-z_]+)'/g)].map(([, name]) => name);

    expect(declared.sort()).toEqual([...ALL_DOCUMENT_TYPES].sort());
  });

  it('resolves a creation path for every type except the one with no canonical location', async () => {
    const answers = ALL_DOCUMENT_TYPES.map((type) => [
      type,
      new DocumentsLocator(emptyFs).locateDefault(rootUri, type, 'thing'),
    ]);

    expect(answers).toEqual([
      ['function', 'file:///project/app/lib/thing.liquid'],
      ['render', 'file:///project/app/views/partials/thing.liquid'],
      ['include', 'file:///project/app/views/partials/thing.liquid'],
      ['background', 'file:///project/app/views/partials/thing.liquid'],
      ['graphql', 'file:///project/app/graphql/thing.graphql'],
      // An asset keeps the extension its reference carries, so nothing is appended.
      ['asset', 'file:///project/app/assets/thing'],
      ['layout', 'file:///project/app/views/layouts/thing.liquid'],
      // Several search-path prefixes are in play: no single place a new file belongs.
      ['theme_render_rc', undefined],
    ]);
  });

  /**
   * The reason `locate` keeps a runtime membership check even though its parameter is
   * typed `DocumentType`: `DocumentLinksProvider` visits every `LiquidTag` and casts
   * `node.name as DocumentType`, so an unrecognized tag genuinely arrives here. It must
   * come back unresolved rather than throw inside an LSP request handler.
   */
  it('answers an unknown tag name without throwing', async () => {
    const locator = new DocumentsLocator(emptyFs);
    const unknown = 'some_third_party_tag' as DocumentType;

    expect([
      await locator.locate(rootUri, unknown, 'thing'),
      await locator.locateOrDefault(rootUri, unknown, 'thing'),
      locator.locateDefault(rootUri, unknown, 'thing'),
      await locator.list(rootUri, 'some_third_party_tag', ''),
    ]).toEqual([undefined, undefined, undefined, []]);
  });

  /** The control for the test above: a KNOWN type must still resolve through the same calls. */
  it('still resolves a known tag name, so the guard above is not swallowing everything', async () => {
    const fs: AbstractFileSystem = {
      ...emptyFs,
      readDirectory: async (uri: string) =>
        uri === 'file:///project/app/views/partials'
          ? [['file:///project/app/views/partials/thing.liquid', FileType.File] as const]
          : [],
    };

    expect(await new DocumentsLocator(fs).locate(rootUri, 'render', 'thing')).toEqual(
      'file:///project/app/views/partials/thing.liquid',
    );
  });
});

const ROOT = 'file:///project';
const rootUri = URI.parse(ROOT);

/**
 * A filesystem over a fixed file list that counts what it was asked.
 *
 * The counts are the point: resolving a render target through the App's name index is a
 * lookup rather than one `stat` per candidate spelling per call site, and the miss path
 * costs one `readDirectory` per candidate DIRECTORY however many format spellings it
 * covers.
 */
class CountingFileSystem implements AbstractFileSystem {
  readonly stats: string[] = [];
  readonly reads: string[] = [];
  readonly listed: string[] = [];

  constructor(private readonly files: readonly string[]) {}

  async stat(uri: string): Promise<FileStat> {
    this.stats.push(uri);
    if (!this.files.includes(uri)) throw new Error(`ENOENT: ${uri}`);
    return { type: FileType.File, size: 0 };
  }

  async readFile(uri: string): Promise<string> {
    this.reads.push(uri);
    return '';
  }

  /** Shallow, like a real `readdir`: direct children only. */
  async readDirectory(uri: string): Promise<FileTuple[]> {
    this.listed.push(uri);
    const prefix = `${uri}/`;
    const entries = new Map<string, FileType>();
    for (const file of this.files) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const cut = rest.indexOf('/');
      if (cut === -1) entries.set(prefix + rest, FileType.File);
      else entries.set(prefix + rest.slice(0, cut), FileType.Directory);
    }
    if (entries.size === 0) throw new Error(`ENOENT: ${uri}`);
    return [...entries];
  }
}

const uri = (relativePath: string) => `${ROOT}/${relativePath}`;

describe('DocumentsLocator resolution through the App index', () => {
  const files = [
    uri('app/views/partials/ui/card.liquid'),
    uri('app/lib/commands/create.liquid'),
    uri('app/graphql/user/find.graphql'),
    uri('modules/core/public/views/partials/badge.liquid'),
  ];

  const withApp = () => {
    const fs = new CountingFileSystem(files);
    const app = App.fromPaths(ROOT, files, fs);
    return { fs, locator: new DocumentsLocator(fs, app) };
  };

  it('resolves a partial, a function and a graphql file with no filesystem access', async () => {
    const { fs, locator } = withApp();

    expect(await locator.locate(rootUri, 'render', 'ui/card')).toBe(
      uri('app/views/partials/ui/card.liquid'),
    );
    expect(await locator.locate(rootUri, 'function', 'commands/create')).toBe(
      uri('app/lib/commands/create.liquid'),
    );
    expect(await locator.locate(rootUri, 'graphql', 'user/find')).toBe(
      uri('app/graphql/user/find.graphql'),
    );
    expect(await locator.locate(rootUri, 'render', 'modules/core/badge')).toBe(
      uri('modules/core/public/views/partials/badge.liquid'),
    );

    expect(fs.stats).toEqual([]);
    expect(fs.reads).toEqual([]);
  });

  it('falls back to the filesystem for a name the app does not have', async () => {
    const { fs, locator } = withApp();

    expect(await locator.locate(rootUri, 'render', 'ghost')).toBe(undefined);
    // One listing per candidate DIRECTORY, not a stat per candidate spelling —
    // which is what lets the miss path cover every response format at the I/O
    // cost of covering one.
    expect(fs.stats).toEqual([]);
    expect(fs.listed).toEqual([uri('app/views/partials'), uri('app/lib')]);
  });

  it('falls back to the filesystem for assets, which the lint app does not collect', async () => {
    // The walk that builds the app only collects Liquid, GraphQL and YAML, so an
    // asset is never in the index. Without the fallback every `{% asset %}` would
    // resolve to "missing".
    const assetUri = uri('app/assets/theme.css');
    const fs = new CountingFileSystem([assetUri]);
    const app = App.fromPaths(ROOT, [], fs);
    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'theme.css')).toBe(assetUri);
    expect(fs.listed).toEqual([uri('app/assets')]);
  });

  it('finds a file that exists only as an unsaved buffer', async () => {
    const fs = new CountingFileSystem([]);
    const app = App.fromPaths(ROOT, [], fs);
    const newUri = uri('app/views/partials/fresh.liquid');
    app.setSource(newUri, '<b>fresh</b>', 0);

    expect(await new DocumentsLocator(fs, app).locate(rootUri, 'render', 'fresh')).toBe(newUri);
    expect(fs.stats).toEqual([]);
  });
});

describe('the index and the candidate walk agree', () => {
  /**
   * The walk encodes precedence as "first candidate path that exists wins"; the index
   * encodes it as a position in the same candidate list. If those ever disagree, the
   * two resolvers answer with different files for the same name — the exact class of
   * bug the App model exists to stop reintroducing.
   */
  const cases: { name: string; files: string[]; lookups: [DocumentType, string][] }[] = [
    {
      name: 'an app-level partial, a module original, and an app/modules overwrite of the same name',
      files: [
        'app/views/partials/card.liquid',
        'modules/core/public/views/partials/card.liquid',
        'app/modules/core/public/views/partials/card.liquid',
      ],
      lookups: [
        ['render', 'card'],
        ['render', 'modules/core/card'],
      ],
    },
    {
      name: 'views/partials against lib for the same name',
      files: ['app/lib/thing.liquid', 'app/views/partials/thing.liquid'],
      lookups: [
        ['render', 'thing'],
        ['function', 'thing'],
      ],
    },
    {
      name: 'a module original with no overwrite',
      files: ['modules/core/private/lib/helper.liquid'],
      lookups: [['function', 'modules/core/helper']],
    },
    {
      name: 'public against private within one module',
      files: [
        'modules/core/private/views/partials/badge.liquid',
        'modules/core/public/views/partials/badge.liquid',
      ],
      lookups: [['render', 'modules/core/badge']],
    },
    {
      name: 'graphql under both graphql/ and graph_queries/',
      files: ['app/graph_queries/find.graphql', 'app/graphql/find.graphql'],
      lookups: [['graphql', 'find']],
    },
    {
      // The TASK-46.14 case: `pathToName` strips ANY known format, so the file's
      // name omits the `.csv` — and the filesystem path must resolve it under
      // that same name, or every caller without an index reports a file the
      // platform renders as missing.
      name: 'a partial whose file carries a response format',
      files: ['app/views/partials/theme/simple/admin/users/csv/index.csv.liquid'],
      lookups: [['render', 'theme/simple/admin/users/csv/index']],
    },
    {
      name: 'a format-carrying file against its plain sibling',
      files: ['app/views/partials/card.json.liquid', 'app/views/partials/card.liquid'],
      lookups: [['render', 'card']],
    },
  ];

  for (const { name, files, lookups } of cases) {
    it(`resolves identically for ${name}`, async () => {
      const uris = files.map(uri);
      const fs = new CountingFileSystem(uris);
      const walkOnly = new DocumentsLocator(fs);
      const indexed = new DocumentsLocator(fs, App.fromPaths(ROOT, uris, fs));

      for (const [documentType, lookup] of lookups) {
        expect([lookup, await indexed.locate(rootUri, documentType, lookup)]).toEqual([
          lookup,
          await walkOnly.locate(rootUri, documentType, lookup),
        ]);
      }
    });
  }
});

describe('DocumentsLocator and assets', () => {
  const asset = uri('app/assets/logo.png');

  /**
   * Assets never come from the index, even when the app holds them.
   *
   * Nothing in this toolchain reads an asset, so the only question ever asked about one
   * is whether it exists. The filesystem answers that in a way an index entry cannot go
   * stale on: the lint's project walk collects no assets and the language server's file
   * watcher does not cover them, so an index would keep resolving an image deleted
   * outside the editor.
   */
  it('asks the filesystem for an asset the app contains rather than answering from the index', async () => {
    const fs = new CountingFileSystem([asset]);
    const app = App.fromPaths(ROOT, [asset], fs);

    // Guard: the app really does hold it, so this proves a deliberate carve-out and
    // not an app that happens to be empty.
    expect(app.find(PlatformOSFileType.Asset, 'logo.png')?.uri).toBe(asset);

    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'logo.png')).toBe(asset);
    expect(fs.listed).toEqual([uri('app/assets')]);
  });

  it('reports an asset that is gone from disk but still in the app', async () => {
    const fs = new CountingFileSystem([]);
    const app = App.fromPaths(ROOT, [asset], fs);
    const locator = new DocumentsLocator(fs, app);

    expect(await locator.locate(rootUri, 'asset', 'logo.png')).toBe(undefined);
  });
});

describe('DocumentsLocator.list', () => {
  it('still enumerates directories, so completions are unchanged', async () => {
    const uris = [
      uri('app/views/partials/ui/card.liquid'),
      uri('app/views/partials/ui/badge.liquid'),
      uri('app/lib/commands/create.liquid'),
    ];
    const fs = new CountingFileSystem(uris);
    const app = App.fromPaths(ROOT, uris, fs);

    const withIndex = await new DocumentsLocator(fs, app).list(rootUri, 'render', '');
    const withoutIndex = await new DocumentsLocator(fs).list(rootUri, 'render', '');

    expect(withIndex).toEqual(withoutIndex);
    expect(withIndex).toEqual(['commands/create', 'ui/badge', 'ui/card']);
  });
});
