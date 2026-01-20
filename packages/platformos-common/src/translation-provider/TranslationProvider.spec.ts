import { describe, it, expect, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { TranslationProvider } from './TranslationProvider';
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
    readDirectory: vi.fn(async (_uri: string): Promise<FileTuple[]> => []),
  };
}

describe('TranslationProvider', () => {
  const rootUri = URI.parse('file:///project');

  describe('findTranslationFile', () => {
    it('should find translation file in app/translations', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/translations/en/general.yml': 'en:\n  hello: Hello',
      });
      const provider = new TranslationProvider(fs);

      const [file, key] = await provider.findTranslationFile(rootUri, 'general.hello', 'en');

      expect(file).toBe('file:///project/app/translations/en/general.yml');
      expect(key).toBe('general.hello');
    });

    it('should find module translation file', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/user/public/translations/en/messages.yml':
          'en:\n  welcome: Welcome',
      });
      const provider = new TranslationProvider(fs);

      const [file, key] = await provider.findTranslationFile(
        rootUri,
        'modules/user/messages.welcome',
        'en',
      );

      expect(file).toBe('file:///project/app/modules/user/public/translations/en/messages.yml');
      expect(key).toBe('messages.welcome');
    });

    it('should return undefined for non-existent translation file', async () => {
      const fs = createMockFileSystem({});
      const provider = new TranslationProvider(fs);

      const [file, key] = await provider.findTranslationFile(rootUri, 'missing.key', 'en');

      expect(file).toBeUndefined();
      expect(key).toBeUndefined();
    });

    it('should return undefined for empty translation key', async () => {
      const fs = createMockFileSystem({});
      const provider = new TranslationProvider(fs);

      const [file, key] = await provider.findTranslationFile(rootUri, '', 'en');

      expect(file).toBeUndefined();
      expect(key).toBeUndefined();
    });
  });

  describe('translate', () => {
    it('should translate a simple key', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/translations/en/general.yml': 'en:\n  general:\n    hello: Hello World',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'general.hello', 'en');

      expect(result).toBe('Hello World');
    });

    it('should translate nested keys', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/translations/en/forms.yml':
          'en:\n  forms:\n    errors:\n      required: This field is required',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'forms.errors.required', 'en');

      expect(result).toBe('This field is required');
    });

    it('should return undefined for missing nested key', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/translations/en/general.yml': 'en:\n  existing: value',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'general.missing.nested', 'en');

      expect(result).toBeUndefined();
    });

    it('should translate module keys', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/admin/public/translations/en/dashboard.yml':
          'en:\n  dashboard:\n    title: Admin Dashboard',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'modules/admin/dashboard.title', 'en');

      expect(result).toBe('Admin Dashboard');
    });

    it('should use default locale when not specified', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/translations/en/common.yml': 'en:\n  common:\n    yes: Yes',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'common.yes');

      expect(result).toBe('Yes');
    });

    it('should check private module translations when public does not exist', async () => {
      const fs = createMockFileSystem({
        'file:///project/app/modules/internal/private/translations/en/secret.yml':
          'en:\n  secret:\n    message: Secret Message',
      });
      const provider = new TranslationProvider(fs);

      const result = await provider.translate(rootUri, 'modules/internal/secret.message', 'en');

      expect(result).toBe('Secret Message');
    });
  });
});
