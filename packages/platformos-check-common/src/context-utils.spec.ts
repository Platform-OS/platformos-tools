import { describe, expect, it } from 'vitest';
import { makeGetDefaultLocale, makeGetDefaultTranslations } from './context-utils';
import { MockFileSystem } from './test';
import { AbstractFileSystem, App } from '@platformos/platformos-common';
import { sourceParsers } from './to-source-code';

const ROOT = 'platformos-vfs:/';
const EN_YML = `${ROOT}app/translations/en.yml`;

/**
 * Files are named by FULL URI to pin the bare-root spelling end to end:
 * `normalizeUri('platformos-vfs:/')` keeps the root slash — a join onto
 * `platformos-vfs:` loses the path's leading slash for every scheme but `file:` — so the
 * URI set here and the one `getDefaultTranslations` derives from the root must land on
 * the same string.
 */
const appWith = (fs: AbstractFileSystem, source?: string, version?: number): App => {
  const app = App.fromSources(ROOT, {}, fs, sourceParsers);
  if (source !== undefined) app.setSource(EN_YML, source, version);
  return app;
};

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

      const getDefaultTranslations = makeGetDefaultTranslations(fs, appWith(fs), ROOT);
      expect(await getDefaultTranslations()).to.eql({ beverage: 'coffee' });
    });

    it('should read a file with a duplicated key, last value winning', async () => {
      // The same tolerance `TranslationProvider` reads translations with, and for the
      // same reason: the platform renders such a file, so treating it as empty invents
      // undefined-key offenses. `YAMLSyntaxError` reports the duplicate itself.
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/en.yml': 'en:\n  beverage: coffee\n  beverage: tea\n',
        },
        'platformos-vfs:/',
      );

      const getDefaultTranslations = makeGetDefaultTranslations(fs, appWith(fs), ROOT);
      expect(await getDefaultTranslations()).to.eql({ beverage: 'tea' });
    });

    it('should return empty object when no en.yml exists', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/fr.yml': 'fr:\n  beverage: café\n',
        },
        'platformos-vfs:/',
      );

      const getDefaultTranslations = makeGetDefaultTranslations(fs, appWith(fs), ROOT);
      expect(await getDefaultTranslations()).to.eql({});
    });

    it('should prefer translations from an open editor buffer over the filesystem', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/en.yml': 'en:\n  beverage: coffee\n',
        },
        'platformos-vfs:/',
      );

      // A version is what makes a file an open buffer rather than a copy of what
      // is on disk — see openBufferSource in context-utils.
      const app = appWith(fs, 'en:\n  beverage: tea\n', 3);

      const getDefaultTranslations = makeGetDefaultTranslations(fs, app, ROOT);
      expect(await getDefaultTranslations()).to.eql({ beverage: 'tea' });
    });

    it('should read from the filesystem for a file that is only on disk, not open', async () => {
      const fs: AbstractFileSystem = new MockFileSystem(
        {
          'app/translations/en.yml': 'en:\n  beverage: coffee\n',
        },
        'platformos-vfs:/',
      );

      const app = appWith(fs, 'en:\n  beverage: stale\n');

      const getDefaultTranslations = makeGetDefaultTranslations(fs, app, ROOT);
      expect(await getDefaultTranslations()).to.eql({ beverage: 'coffee' });
    });
  });
});
