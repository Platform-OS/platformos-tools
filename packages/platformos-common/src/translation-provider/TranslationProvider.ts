import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { URI, Utils } from 'vscode-uri';
import yaml from 'js-yaml';

type ModuleKeyInfo =
  | { isModule: false; key: string }
  | { isModule: true; moduleName: string; key: string };

export class TranslationProvider {
  constructor(private readonly fs: AbstractFileSystem) {}

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

  private parseModuleKey(translationKey: string): ModuleKeyInfo {
    if (!translationKey.startsWith('modules/')) {
      return { isModule: false, key: translationKey };
    }

    const [, moduleName, key] = translationKey.split('/', 3);

    return key ? { isModule: true, moduleName, key } : { isModule: false, key: translationKey };
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
    const parsed = this.parseModuleKey(translationKey);

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
