import { beforeEach, describe, expect, it } from 'vitest';
import { makeGetDefaultLocale, makeGetDefaultTranslations } from './context-utils';
import { MockFileSystem } from './test';
import { AbstractFileSystem } from '@platformos/platformos-common';

describe('Unit: getDefaultLocale', () => {
  it('should always return en (en.yml is the reference locale file)', async () => {
    const fs: AbstractFileSystem = new MockFileSystem(
      {
        'app/translations/en.yml': 'en:\n  beverage: coffee\n',
        'app/translations/fr.yml': 'fr:\n  beverage: café\n',
      },
      'platformos-vfs:/',
    );

    const getDefaultLocale = makeGetDefaultLocale(fs, 'platformos-vfs:/');
    expect(await getDefaultLocale()).to.eql('en');
  });

  it('should return en even when no translation files exist', async () => {
    const fs: AbstractFileSystem = new MockFileSystem({}, 'platformos-vfs:/');
    const getDefaultLocale = makeGetDefaultLocale(fs, 'platformos-vfs:/');
    expect(await getDefaultLocale()).to.eql('en');
  });

  describe('Unit: getDefaultTranslationsFactory', () => {
    it('should return translations from en.yml stripped of the locale prefix', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/en.yml': 'en:\n  beverage: coffee\n',
          'app/translations/fr.yml': 'fr:\n  beverage: café\n',
        },
        'platformos-vfs:/',
      );

      const getDefaultTranslations = makeGetDefaultTranslations(fs, [], 'platformos-vfs:/');
      expect(await getDefaultTranslations()).to.eql({ beverage: 'coffee' });
    });

    it('should return empty object when no en.yml exists', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/fr.yml': 'fr:\n  beverage: café\n',
        },
        'platformos-vfs:/',
      );

      const getDefaultTranslations = makeGetDefaultTranslations(fs, [], 'platformos-vfs:/');
      expect(await getDefaultTranslations()).to.eql({});
    });

    it('should prefer translations from the in-memory app buffer over the filesystem', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/en.yml': 'en:\n  beverage: coffee\n',
        },
        'platformos-vfs:/',
      );

      // Simulate an open buffer with different content
      const { toSourceCode } = await import('./to-source-code');
      const bufferedSourceCode = toSourceCode(
        'platformos-vfs:/app/translations/en.yml',
        'en:\n  beverage: tea\n',
      );

      const getDefaultTranslations = makeGetDefaultTranslations(
        fs,
        [bufferedSourceCode],
        'platformos-vfs:/',
      );
      expect(await getDefaultTranslations()).to.eql({ beverage: 'tea' });
    });
  });
});
