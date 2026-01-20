import { describe, it, expect, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { DocumentsLocator } from './DocumentsLocator';
import { AbstractFileSystem, FileType, FileStat, FileTuple } from '../AbstractFileSystem';

function createMockFileSystem(files: Record<string, string>): AbstractFileSystem {
  const fileSet = new Set(Object.keys(files));

  return {
    stat: vi.fn(async (uri: string): Promise<FileStat> => {
      if (fileSet.has(uri)) {
        return { type: FileType.File, size: files[uri].length };
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
      for (const filePath of fileSet) {
        if (filePath.startsWith(uri)) {
          results.push([filePath, FileType.File]);
        }
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
        'file:///project/app/modules/user/public/lib/helper.liquid': '{% comment %}helper{% endcomment %}',
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
        'file:///project/app/modules/admin/private/views/partials/secret.liquid': '<div>secret</div>',
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
});
