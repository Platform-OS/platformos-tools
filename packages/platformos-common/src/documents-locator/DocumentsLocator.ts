import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { getAppPaths, getModulePaths, PlatformOSFileType } from '../path-utils';
import { URI, Utils } from 'vscode-uri';

export type DocumentType = 'function' | 'render' | 'include' | 'graphql' | 'asset';

type ModulePathInfo =
  | { isModule: false; key: string }
  | { isModule: true; moduleName: string; key: string };

export class DocumentsLocator {
  constructor(private readonly fs: AbstractFileSystem) {}

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await this.fs.stat(path)).type === FileType.File;
    } catch {
      return false;
    }
  }

  private parseModulePath(fileName: string): ModulePathInfo {
    if (!fileName.startsWith('modules/')) {
      return { isModule: false, key: fileName };
    }

    const [, moduleName, ...rest] = fileName.split('/');
    const key = rest.join('/');

    return moduleName ? { isModule: true, moduleName, key } : { isModule: false, key: fileName };
  }

  private getSearchPaths(type: 'partial' | 'graphql' | 'asset', moduleName?: string): string[] {
    const fileType: PlatformOSFileType = {
      partial: PlatformOSFileType.Partial,
      graphql: PlatformOSFileType.GraphQL,
      asset: PlatformOSFileType.Asset,
    }[type];

    return moduleName ? getModulePaths(fileType, moduleName) : getAppPaths(fileType);
  }

  private async locateFile(
    rootUri: URI,
    fileName: string,
    type: 'partial' | 'graphql' | 'asset',
  ): Promise<string | undefined> {
    const parsed = this.parseModulePath(fileName);
    const searchPaths = this.getSearchPaths(type, parsed.isModule ? parsed.moduleName : undefined);

    let targetFile = parsed.key;
    if (type === 'partial') {
      targetFile += '.liquid';
    } else if (type === 'graphql') {
      targetFile += '.graphql';
    }

    for (const basePath of searchPaths) {
      const uri = Utils.joinPath(rootUri, basePath, targetFile).toString();

      if (await this.isFile(uri)) {
        return uri;
      }
    }

    return undefined;
  }

  private async listFiles(
    rootUri: URI,
    filePrefix: string,
    type: 'partial' | 'graphql' | 'asset',
  ): Promise<string[]> {
    const parsed = this.parseModulePath(filePrefix);
    const searchPaths = this.getSearchPaths(type, parsed.isModule ? parsed.moduleName : undefined);

    const results = new Set<string>();

    const matchesType = (name: string): boolean => {
      switch (type) {
        case 'partial':
          return name.endsWith('.liquid');
        case 'graphql':
          return name.endsWith('.graphql');
        case 'asset':
          return true;
      }
    };

    const walk = async (basePath: string, dirUri: URI): Promise<void> => {
      let entries: [string, FileType][];
      try {
        entries = await this.fs.readDirectory(dirUri.toString());
      } catch {
        return;
      }

      for (const [name, fileType] of entries) {
        if (fileType === FileType.Directory) {
          await walk(basePath, URI.parse(name));
          continue;
        }

        if (fileType !== FileType.File) continue;
        if (!matchesType(name)) continue;

        const parsedName = name.slice(basePath.length);
        if (!parsedName.startsWith('/' + parsed.key)) continue;
        let result = parsedName.slice(parsed.key.length);

        if ((parsed.key.endsWith('/') || parsed.key === '') && result.startsWith('/'))
          result = result.slice(1);

        if (type !== 'asset') {
          const index = result.lastIndexOf('.');
          result = index === -1 ? result : result.slice(0, index);
        }
        results.add(result);
      }
    };

    for (const basePath of searchPaths) {
      const baseUri = Utils.joinPath(rootUri, basePath);
      await walk(baseUri.toString(), baseUri);
    }

    return Array.from(results).sort((a, b) => a.localeCompare(b));
  }

  async locate(
    rootUri: URI,
    nodeName: DocumentType,
    fileName: string,
  ): Promise<string | undefined> {
    switch (nodeName) {
      case 'render':
      case 'include':
      case 'function':
        return this.locateFile(rootUri, fileName, 'partial');

      case 'graphql':
        return this.locateFile(rootUri, fileName, 'graphql');

      case 'asset':
        return this.locateFile(rootUri, fileName, 'asset');

      default:
        return undefined;
    }
  }

  async list(rootUri: URI, nodeName: string | undefined, filePrefix: string): Promise<string[]> {
    switch (nodeName) {
      case 'function':
      case 'render':
      case 'include':
        return this.listFiles(rootUri, filePrefix, 'partial');

      case 'graphql':
        return this.listFiles(rootUri, filePrefix, 'graphql');

      case 'asset':
        return this.listFiles(rootUri, filePrefix, 'asset');

      default:
        return [];
    }
  }
}
