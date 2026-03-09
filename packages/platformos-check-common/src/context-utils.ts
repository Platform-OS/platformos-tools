import { load } from 'js-yaml';
import {
  AbstractFileSystem,
  FileTuple,
  FileType,
  RouteTable,
  TranslationProvider,
  UriString,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { join } from './path';
import { SourceCodeType, App, Translations } from './types';

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
export const makeGetTranslationsForBase = (fs: AbstractFileSystem, app: App) => {
  const provider = new TranslationProvider(fs);
  const cache = new Map<string, Promise<Translations>>();

  return (translationBaseUri: string, locale: string): Promise<Translations> => {
    const key = `${translationBaseUri}::${locale}`;
    if (!cache.has(key)) {
      const contentOverride = (uri: string): string | undefined =>
        app.find((sc) => sc.type === SourceCodeType.YAML && sc.uri === uri)?.source;

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

export const makeGetDefaultTranslations = (fs: AbstractFileSystem, app: App, rootUri: string) =>
  cached(() => getDefaultTranslations(fs, app, rootUri));

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
  app: App,
  rootUri: string,
): Promise<Translations> {
  try {
    const bufferTranslations = getDefaultTranslationsFromBuffer(app);
    if (bufferTranslations) return bufferTranslations;
    const defaultLocaleFile = await getDefaultLocaleFile(fs, rootUri);
    if (!defaultLocaleFile) return {};
    const yamlContent = await fs.readFile(defaultLocaleFile);
    const data = load(yamlContent) as Record<string, any>;
    if (!data || typeof data !== 'object') return {};
    // YAML translation files wrap content under the locale key: { en: { hello: 'Hello' } }
    const localeKey = Object.keys(data)[0];
    return (localeKey && data[localeKey]) ?? {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

/** It might be that you have an open buffer, we prefer translations from there if available */
function getDefaultTranslationsFromBuffer(app: App): Translations | undefined {
  const defaultTranslationsSourceCode = app.find(
    (sourceCode) => sourceCode.type === SourceCodeType.YAML && sourceCode.uri.endsWith('/en.yml'),
  );
  if (!defaultTranslationsSourceCode) return undefined;
  try {
    const data = load(defaultTranslationsSourceCode.source) as Record<string, any>;
    if (!data || typeof data !== 'object') return undefined;
    const localeKey = Object.keys(data)[0];
    return (localeKey && data[localeKey]) ?? undefined;
  } catch {
    return undefined;
  }
}

export function makeGetRouteTable(
  fs: AbstractFileSystem,
  rootUri: string,
): () => Promise<RouteTable> {
  let buildPromise: Promise<RouteTable> | null = null;
  return () => {
    if (!buildPromise) {
      const table = new RouteTable(fs);
      buildPromise = table.build(URI.parse(rootUri)).then(() => table);
    }
    return buildPromise;
  };
}

function cached<T>(fn: () => Promise<T>): () => Promise<T>;
function cached<T>(fn: (...args: any[]) => Promise<T>): (...args: any[]) => Promise<T> {
  let cachedPromise: Promise<T>;
  return async (...args) => {
    if (!cachedPromise) cachedPromise = fn(...args);
    return cachedPromise;
  };
}

export async function recursiveReadDirectory(
  fs: AbstractFileSystem,
  uri: string,
  filter: (fileTuple: FileTuple) => boolean,
): Promise<UriString[]> {
  const allFiles = await fs.readDirectory(uri);
  const files = allFiles.filter((ft) => !isIgnored(ft) && (isDirectory(ft) || filter(ft)));

  const results = await Promise.all(
    files.map((ft) => {
      if (isDirectory(ft)) {
        return recursiveReadDirectory(fs, ft[0], filter);
      } else {
        return Promise.resolve([ft[0]]);
      }
    }),
  );

  return results.flat();
}

export function isDirectory([_, type]: FileTuple) {
  return type === FileType.Directory;
}

const ignoredFolders = ['.git', 'node_modules', 'dist', 'build', 'tmp', 'vendor'];

function isIgnored([uri, type]: FileTuple) {
  return type === FileType.Directory && ignoredFolders.some((folder) => uri.endsWith(folder));
}
