import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { parseModulePrefix } from '../path-utils';
import { URI, Utils } from 'vscode-uri';
import yaml from 'js-yaml';

import { PLATFORM_YAML_LOAD_OPTIONS } from '../yaml-load-options';

/**
 * Every `load` below sits inside a `try`/`catch` that treats a throw as "this file has
 * no translations", so js-yaml's default made one repeated key empty an entire locale
 * and every key in it appear missing. See {@link PLATFORM_YAML_LOAD_OPTIONS}.
 */
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

  static getSearchPaths(moduleName?: string): string[] {
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

    const searchPaths = TranslationProvider.getSearchPaths(
      parsed.isModule ? parsed.moduleName : undefined,
    );

    for (const basePath of searchPaths) {
      // Strategy A: single locale file ({basePath}/{locale}.yml)
      const singleFileUri = Utils.joinPath(rootUri, basePath, `${defaultLocale}.yml`).toString();
      const singleContents = await this.readFileIfExists(singleFileUri);
      if (singleContents) {
        const data = this.loadYaml(singleContents);
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
          const data = this.loadYaml(contents);
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
   * A translation file's YAML, or `undefined` when it does not parse.
   *
   * `json: true` is js-yaml's JSON-compatibility mode, and the reason it is on is the
   * DUPLICATED MAPPING KEY — two translators adding the same key, which every real
   * project has. Strict js-yaml rejects the whole document for it; the platform renders
   * it, last value winning, and so does this. Reading such a file as EMPTY instead is
   * far worse than reading it last-wins: on one real project five of the 39 `en/*.yml`
   * files had a duplicate, and every key in them looked undefined to both
   * `MatchingTranslations` and `TranslationKeyExists` — 561 offenses that were not
   * there. `YAMLSyntaxError` is what tells the author about the duplicate itself.
   *
   * A parse failure that survives all that is a VALUE here, never an exception — the
   * same contract `AppFile.ast` keeps, and for the same reason. When it escaped, one bad
   * file took out a whole language-server feature for every file in the project:
   * `DocumentLinksProvider` resolves `{{ '…' | t }}` through
   * {@link findTranslationFile}, so the request rejected and the editor got NO links at
   * all — not even the `render` ones it had already resolved. Hover and go-to-definition
   * kept working, because they are separate requests, which made it look like the links
   * had simply stopped being produced.
   */
  private loadYaml(content: string): unknown {
    try {
      // The named constant, not an inline `{ json: true }`: this is one decision that has
      // to hold at EVERY `yaml.load` in the repo, and `yaml-load-options.ts` is where it
      // is stated once — with the `--dry-run` measurement that the platform accepts a
      // duplicated key last-wins, and the list of 26 constructs verified unaffected by the
      // flag. A second inline copy is how a reader ends up quietly disagreeing with the
      // linter about what a file says, which is exactly what happened to
      // `DocumentsLocator.loadSearchPaths`.
      return yaml.load(content, PLATFORM_YAML_LOAD_OPTIONS);
    } catch {
      return undefined;
    }
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
    const data = this.loadYaml(content) as Record<string, any>;
    if (!data || typeof data !== 'object') return undefined;
    const firstKey = Object.keys(data)[0];
    if (firstKey !== expectedLocale) return undefined;
    return data[firstKey] ?? undefined;
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

    let data: any = this.loadYaml(contents);

    for (const part of [defaultLocale, ...key.split('.')]) {
      data = data?.[part];
      if (data === undefined) {
        return undefined;
      }
    }

    return data;
  }
}
