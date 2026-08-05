import { load } from 'js-yaml';
import {
  AbstractFileSystem,
  PLATFORM_YAML_LOAD_OPTIONS,
  RouteTable,
  TranslationProvider,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { join } from './path';
import { AppModel, Translations } from './types';

/**
 * The contents of an OPEN editor buffer for `uri`, or `undefined` when the file's
 * authoritative contents are whatever is on disk.
 *
 * A version is what makes a file a buffer — that is the language-server
 * convention the whole toolchain shares, and `undefined` means "on disk". Keying
 * on it rather than on "is this file in the app object" is also what keeps
 * translations correct once files load lazily: an unloaded on-disk file has no
 * contents to offer, and forcing a read to find that out would defeat the point.
 *
 * `source` cannot throw here even though it throws on an unloaded file: the only
 * writer of a non-`undefined` `version` is `AppFile.setSource`, which sets the
 * source in the same breath, so a versioned file is a loaded file.
 */
function openBufferSource(app: AppModel, uri: string): string | undefined {
  const file = app.get(uri);
  return file === undefined || file.version === undefined ? undefined : file.source;
}

/**
 * Returns a function that loads and merges ALL translation files for a given
 * locale within a specific translations base directory URI
 * (e.g. `file:///app/translations` or
 * `file:///modules/common-styling/public/translations`).
 *
 * Covers both the single-file layout (`{base}/{locale}.yml`) and the split-file
 * layout (`{base}/{locale}/*.yml`).
 *
 * Only files whose first YAML key matches `locale` are included — this mirrors
 * how platformOS determines a file's locale from its content, not its path.
 *
 * In-memory editor buffers take precedence over the filesystem so that unsaved
 * changes are reflected immediately.
 */
export const makeGetTranslationsForBase = (fs: AbstractFileSystem, app: AppModel) => {
  const provider = new TranslationProvider(fs);
  const cache = new Map<string, Promise<Translations>>();

  return (translationBaseUri: string, locale: string): Promise<Translations> => {
    const key = `${translationBaseUri}::${locale}`;
    if (!cache.has(key)) {
      const contentOverride = (uri: string): string | undefined => openBufferSource(app, uri);

      cache.set(
        key,
        provider.loadAllTranslationsForBase(URI.parse(translationBaseUri), locale, contentOverride),
      );
    }
    return cache.get(key)!;
  };
};

export type FileExists = (uri: string) => Promise<boolean>;

export const makeFileExists = (fs: AbstractFileSystem): FileExists =>
  async function fileExists(uri: string) {
    try {
      await fs.stat(uri);
      return true;
    } catch (e) {
      return false;
    }
  };

export const makeFileSize = (fs: AbstractFileSystem) =>
  async function fileSize(uri: string) {
    try {
      const stats = await fs.stat(uri);
      return stats.size;
    } catch (error) {
      return 0;
    }
  };

export const makeGetDefaultLocaleFileUri = (fs: AbstractFileSystem) => (rootUri: string) =>
  getDefaultLocaleFile(fs, rootUri);

export const makeGetDefaultLocale = (fs: AbstractFileSystem, rootUri: string) =>
  cached(() => getDefaultLocale(fs, rootUri));

export const makeGetDefaultTranslations = (
  fs: AbstractFileSystem,
  app: AppModel,
  rootUri: string,
) => cached(() => getDefaultTranslations(fs, app, rootUri));

async function getDefaultLocaleFile(
  fs: AbstractFileSystem,
  rootUri: string,
): Promise<string | undefined> {
  const enYmlUri = join(rootUri, 'app/translations/en.yml');
  try {
    await fs.stat(enYmlUri);
    return enYmlUri;
  } catch {
    return undefined;
  }
}

async function getDefaultLocale(_fs: AbstractFileSystem, _rootUri: string): Promise<string> {
  // In platformOS, en.yml is always the reference translation file
  return 'en';
}

async function getDefaultTranslations(
  fs: AbstractFileSystem,
  app: AppModel,
  rootUri: string,
): Promise<Translations> {
  const defaultLocaleUri = join(rootUri, 'app/translations/en.yml');
  try {
    // An unsaved edit to the reference locale file is what the rest of the run
    // should be checked against, so it wins over the copy on disk. The `??` also
    // keeps the `stat` off the buffer path — asking the disk whether the file
    // exists is pointless once an open buffer has answered.
    const yamlContent =
      openBufferSource(app, defaultLocaleUri) ??
      ((await getDefaultLocaleFile(fs, rootUri)) && (await fs.readFile(defaultLocaleUri)));
    if (!yamlContent) return {};
    const data = load(yamlContent, PLATFORM_YAML_LOAD_OPTIONS) as Record<string, any>;
    if (!data || typeof data !== 'object') return {};
    // YAML translation files wrap content under the locale key: { en: { hello: 'Hello' } }
    const localeKey = Object.keys(data)[0];
    return (localeKey && data[localeKey]) ?? {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

/**
 * The run's `getRouteTable`: at most one table per run, produced the first time a
 * check asks for one.
 *
 * The laziness is the point, not a detail. Every page in the project has to be read
 * to know its route — whole-project I/O that no amount of lazy parsing avoids — and
 * `MissingPage` is the only check that consumes it. On real projects 3-13% of Liquid
 * files contain an `<a href>` or `<form action>` at all, so a run that resolves the
 * table up front does that I/O for nothing nine times out of ten.
 */
export function makeGetRouteTable(
  fs: AbstractFileSystem,
  rootUri: string,
  provider?: () => Promise<RouteTable>,
): () => Promise<RouteTable> {
  let tablePromise: Promise<RouteTable> | null = null;
  return () => {
    if (!tablePromise) {
      tablePromise = resolveRouteTable(fs, rootUri, provider).catch((err) => {
        tablePromise = null;
        throw err;
      });
    }
    return tablePromise;
  };
}

async function resolveRouteTable(
  fs: AbstractFileSystem,
  rootUri: string,
  provider?: () => Promise<RouteTable>,
): Promise<RouteTable> {
  // A provider owns making its own table current, so it is asked, verbatim:
  // check-node's reconciles a process-level table against the pages on disk and
  // the language server's builds its event-maintained one on first use — either
  // way, a `build()` here would throw that work away and redo it.
  if (provider) return provider();

  const table = new RouteTable(fs);
  await table.build(URI.parse(rootUri));
  return table;
}

function cached<T>(fn: () => Promise<T>): () => Promise<T>;
function cached<T>(fn: (...args: any[]) => Promise<T>): (...args: any[]) => Promise<T> {
  let cachedPromise: Promise<T>;
  return async (...args) => {
    if (!cachedPromise) cachedPromise = fn(...args);
    return cachedPromise;
  };
}
