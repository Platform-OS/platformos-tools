import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { parseModulePrefix } from '../path-utils';
import { URI, Utils } from 'vscode-uri';
import yaml from 'js-yaml';

export class TranslationProvider {
  constructor(private readonly fs: AbstractFileSystem) {}

  /** Cache for filesystem-only translation loads (bypassed when contentOverride is set). */
  private translationsCache = new Map<string, Record<string, any>>();

  /**
   * Invalidate cached translations. Call after any translation file is written
   * to disk so subsequent calls re-read from the filesystem.
   *
   * Omitting `uri` clears the entire cache.
   * Passing a `uri` removes only the entries whose base directory contains that file.
   */
  clearTranslationsCache(uri?: string): void {
    if (!uri) {
      this.translationsCache.clear();
      return;
    }
    for (const key of this.translationsCache.keys()) {
      const baseUri = key.slice(0, key.lastIndexOf(':'));
      if (uri.startsWith(baseUri)) {
        this.translationsCache.delete(key);
      }
    }
  }

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await this.fs.stat(path)).type === FileType.File;
    } catch {
      return false;
    }
  }

  private async readFileIfExists(path: string): Promise<string | undefined> {
    return (await this.isFile(path)) ? this.fs.readFile(path) : undefined;
  }

  private async listYmlFiles(dirUri: string): Promise<string[]> {
    try {
      const entries = await this.fs.readDirectory(dirUri);
      return entries
        .filter(([, type]) => type === FileType.File)
        .map(([name]) => name)
        .filter((name) => name.endsWith('.yml'));
    } catch {
      return [];
    }
  }

  private findKeyInYaml(data: any, defaultLocale: string, key: string): boolean {
    let pointer = data;
    for (const part of [defaultLocale, ...key.split('.')]) {
      pointer = pointer?.[part];
      if (pointer === undefined) return false;
    }
    return true;
  }

  private getSearchPaths(moduleName?: string): string[] {
    if (!moduleName) {
      return ['app/translations'];
    }

    return [
      `app/modules/${moduleName}/public/translations`,
      `app/modules/${moduleName}/private/translations`,
      `modules/${moduleName}/public/translations`,
      `modules/${moduleName}/private/translations`,
    ];
  }

  async findTranslationFile(
    rootUri: URI,
    translationKey: string,
    defaultLocale: string,
  ): Promise<[string | undefined, string | undefined]> {
    const parsed = parseModulePrefix(translationKey);

    if (!parsed.key) {
      return [undefined, undefined];
    }

    const searchPaths = this.getSearchPaths(parsed.isModule ? parsed.moduleName : undefined);

    for (const basePath of searchPaths) {
      // Strategy A: single locale file ({basePath}/{locale}.yml)
      const singleFileUri = Utils.joinPath(rootUri, basePath, `${defaultLocale}.yml`).toString();
      const singleContents = await this.readFileIfExists(singleFileUri);
      if (singleContents) {
        const data = yaml.load(singleContents);
        if (this.findKeyInYaml(data, defaultLocale, parsed.key)) {
          return [singleFileUri, parsed.key];
        }
      }

      // Strategy B: scan all yml files in locale directory ({basePath}/{locale}/*.yml)
      const localeDirUri = Utils.joinPath(rootUri, basePath, defaultLocale).toString();
      const ymlFiles = await this.listYmlFiles(localeDirUri);
      for (const fileUri of ymlFiles) {
        const contents = await this.readFileIfExists(fileUri);
        if (contents) {
          const data = yaml.load(contents);
          if (this.findKeyInYaml(data, defaultLocale, parsed.key)) {
            return [fileUri, parsed.key];
          }
        }
      }
    }

    return [undefined, undefined];
  }

  /**
   * Aggregates ALL translation files for `locale` within `translationBaseUri`.
   *
   * Covers two layouts:
   *  - Single file:  `{base}/{locale}.yml`
   *  - Split files:  `{base}/{locale}/*.yml`
   *
   * Only files whose first YAML key matches `locale` are included, so a file
   * placed in the wrong directory (or accidentally containing a different
   * locale) is silently ignored.
   *
   * @param contentOverride Optional function called before the filesystem is
   *   consulted.  Return the file's source string to use it instead of the
   *   on-disk content, or `undefined` to fall through to the filesystem.
   *   Used by editor integrations to honour unsaved buffer changes.
   */
  async loadAllTranslationsForBase(
    translationBaseUri: URI,
    locale: string,
    contentOverride?: (uri: string) => string | undefined,
  ): Promise<Record<string, any>> {
    const cacheKey = `${translationBaseUri.toString()}:${locale}`;

    // Return cached result when the caller has no editor overrides (e.g. linter/CI).
    // Skip cache when contentOverride is set — unsaved buffer content may differ from disk.
    if (!contentOverride && this.translationsCache.has(cacheKey)) {
      return this.translationsCache.get(cacheKey)!;
    }

    const merged: Record<string, any> = {};

    const read = async (uri: string): Promise<string | undefined> => {
      if (contentOverride) {
        const buffered = contentOverride(uri);
        if (buffered !== undefined) return buffered;
      }
      return this.readFileIfExists(uri);
    };

    // Strategy A: single locale file ({base}/{locale}.yml)
    const singleFileUri = Utils.joinPath(translationBaseUri, `${locale}.yml`).toString();
    const singleContent = await read(singleFileUri);
    if (singleContent) {
      const parsed = this.parseTranslationFile(singleContent, locale);
      if (parsed) this.deepMerge(merged, parsed);
    }

    // Strategy B: locale directory ({base}/{locale}/*.yml)
    const localeDirUri = Utils.joinPath(translationBaseUri, locale).toString();
    const ymlFiles = await this.listYmlFiles(localeDirUri);
    for (const fileUri of ymlFiles) {
      const content = await read(fileUri);
      if (content) {
        const parsed = this.parseTranslationFile(content, locale);
        if (parsed) this.deepMerge(merged, parsed);
      }
    }

    if (!contentOverride) {
      this.translationsCache.set(cacheKey, merged);
    }

    return merged;
  }

  /**
   * Parses a YAML translation file and returns its contents under the locale
   * key.  Returns `undefined` if the file cannot be parsed or if its first
   * key does not match `expectedLocale` (guards against mis-placed files).
   */
  private parseTranslationFile(
    content: string,
    expectedLocale: string,
  ): Record<string, any> | undefined {
    try {
      const data = yaml.load(content) as Record<string, any>;
      if (!data || typeof data !== 'object') return undefined;
      const firstKey = Object.keys(data)[0];
      if (firstKey !== expectedLocale) return undefined;
      return data[firstKey] ?? undefined;
    } catch {
      return undefined;
    }
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): void {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'object' && value !== null && typeof target[key] === 'object') {
        this.deepMerge(target[key], value);
      } else {
        target[key] = value;
      }
    }
  }

  async translate(
    rootUri: URI,
    translationKey: string,
    defaultLocale: string = 'en',
  ): Promise<string | undefined> {
    const [file, key] = await this.findTranslationFile(rootUri, translationKey, defaultLocale);

    if (!file || !key) {
      return undefined;
    }

    const contents = await this.readFileIfExists(file);
    if (!contents) {
      return undefined;
    }

    let data: any = yaml.load(contents);

    for (const part of [defaultLocale, ...key.split('.')]) {
      data = data?.[part];
      if (data === undefined) {
        return undefined;
      }
    }

    return data;
  }
}
