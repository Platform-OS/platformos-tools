import { beforeEach, describe, expect, it } from 'vitest';
import { MockFileSystem } from './MockFileSystem';
import { FileType } from '@platformos/platformos-common';

describe('MockFileSystem', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem({
      'app/views/layouts/layout.liquid': 'layout.liquid content',
      'app/views/layouts/password.liquid': 'password.liquid content',
      'app/views/partials/product-card.liquid': 'product-card.liquid content',
      'app/views/partials/product-variant.liquid': 'product-variant.liquid content',
      'assets/js/foo.js': 'foo.js content',
      'assets/js/bar.js': 'bar.js content',
      'assets/app.js': 'app.js content',
    });
  });

  describe('readFile', () => {
    it('returns the content of existing files', async () => {
      expect(await fs.readFile('file:/app/views/layouts/layout.liquid')).toBe(
        'layout.liquid content',
      );
      expect(await fs.readFile('file:/assets/js/foo.js')).toBe('foo.js content');
    });

    it('throws an error for files that do not exist', async () => {
      await expect(fs.readFile('does not exist')).rejects.toThrow('File not found');
    });
  });

  describe('readDirectory', () => {
    it('returns the list of files in a leaf', async () => {
      const result = await fs.readDirectory('file:/app/views/layouts');
      expect(result).to.eql([
        ['file:/app/views/layouts/layout.liquid', FileType.File],
        ['file:/app/views/layouts/password.liquid', FileType.File],
      ]);
    });

    it('returns the list of files and directories in a branch', async () => {
      const result = await fs.readDirectory('file:/assets');
      expect(result).to.eql([
        ['file:/assets/js', FileType.Directory],
        ['file:/assets/app.js', FileType.File],
      ]);
    });

    it('returns the list of files and directories at the root', async () => {
      const result = await fs.readDirectory('file:/');
      expect(result).to.eql([
        ['file:/app', FileType.Directory],
        ['file:/assets', FileType.Directory],
      ]);
    });

    it('throws an error for directories that do not exist', async () => {
      await expect(fs.readDirectory('file:/does not exist')).rejects.toThrow('Directory not found');
    });
  });

  describe('stat', () => {
    it('returns the size of existing files', async () => {});

    it('throws an error for files that do not exist', async () => {
      await expect(fs.stat('file:/does not exist')).rejects.toThrow();
    });
  });
});
