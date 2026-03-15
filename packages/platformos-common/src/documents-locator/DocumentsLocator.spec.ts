import { describe, it, expect, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { DocumentsLocator, loadSearchPaths } from './DocumentsLocator';
import { AbstractFileSystem, FileType, FileStat, FileTuple } from '../AbstractFileSystem';

function createMockFileSystem(files: Record<string, string>): AbstractFileSystem {
  const fileSet = new Set(Object.keys(files));

  // Build directory tree from file paths
  const dirs = new Set<string>();
  for (const filePath of fileSet) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  return {
    stat: vi.fn(async (uri: string): Promise<FileStat> => {
      if (fileSet.has(uri)) {
        return { type: FileType.File, size: files[uri].length };
      }
      if (dirs.has(uri)) {
        return { type: FileType.Directory, size: 0 };
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readFile: vi.fn(async (uri: string): Promise<string> => {
      if (fileSet.has(uri)) {
        return files[uri];
      }
      throw new Error(`File not found: ${uri}`);
    }),
    readDirectory: vi.fn(async (uri: string): Promise<FileTuple[]> => {
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
      // readDirectory should not be called again for wildcard expansion
      // (only for locateFile stat calls, not for listSubdirectories)
      const expansionCalls = readDirSpy.mock.calls.filter(
        (call: string[]) =>
          call[0].includes('app/views/partials/theme') && !call[0].includes('.liquid'),
      );
      // All expansion readDirectory calls should come from the first invocation
      const expansionCallsAfterFirst = readDirSpy.mock.calls
        .slice(callCountAfterFirst)
        .filter(
          (call: string[]) =>
            call[0].includes('app/views/partials/theme') && !call[0].includes('.liquid'),
        );
      expect(expansionCallsAfterFirst).toHaveLength(0);
    });

    it('should clear expanded paths cache', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/views/partials/theme/v1/card.liquid': 'v1',
      });
      const locator = new DocumentsLocator(fs);

      const result1 = await locator.locateWithSearchPaths(rootUri, 'card', ['theme/{{ version }}']);
      expect(result1).toBe('file:///project/app/views/partials/theme/v1/card.liquid');

      locator.clearExpandedPathsCache();

      // After clearing, a fresh expansion should work (same result since fs unchanged)
      const result2 = await locator.locateWithSearchPaths(rootUri, 'card', ['theme/{{ version }}']);
      expect(result2).toBe('file:///project/app/views/partials/theme/v1/card.liquid');
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
        'file:///project/app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
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
        'file:///project/app/config.yml': 'theme_search_paths:\n  - 123\n  - true\n  - null',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual(['123', 'true', 'null']);
    });

    it('should handle config with Liquid expressions in paths', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/config.yml':
          'theme_search_paths:\n  - "theme/{{ context.constants.MY_THEME | default: \'custom\' }}"\n  - theme/simple',
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
        'file:///project/app/config.yml':
          'some_setting: true\ntheme_search_paths:\n  - theme/dress\nanother_setting: 42',
      });

      const result = await loadSearchPaths(fs, rootUri);
      expect(result).toEqual(['theme/dress']);
    });
  });
});
