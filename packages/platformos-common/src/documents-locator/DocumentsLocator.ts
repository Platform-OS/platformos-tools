import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
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

  private getSearchPaths(
    type: 'partial' | 'view' | 'graphql' | 'asset',
    moduleName?: string,
  ): string[] {
    if (!moduleName) {
      switch (type) {
        case 'partial':
          return ['app/lib'];
        case 'view':
          return ['app/views/partials', 'app/lib'];
        case 'graphql':
          return ['app/graphql'];
        case 'asset':
          return ['app/assets'];
      }
    }

    switch (type) {
      case 'partial':
        return [
          `app/modules/${moduleName}/public/lib`,
          `app/modules/${moduleName}/private/lib`,
          `modules/${moduleName}/public/lib`,
          `modules/${moduleName}/private/lib`,
        ];
      case 'view':
        return [
          `app/modules/${moduleName}/public/views/partials`,
          `app/modules/${moduleName}/private/views/partials`,
          `modules/${moduleName}/public/views/partials`,
          `modules/${moduleName}/private/views/partials`,
        ];
      case 'graphql':
        return [
          `app/modules/${moduleName}/public/graphql`,
          `app/modules/${moduleName}/private/graphql`,
          `modules/${moduleName}/public/graphql`,
          `modules/${moduleName}/private/graphql`,
        ];
      case 'asset':
        return [
          `app/modules/${moduleName}/public/assets`,
          `app/modules/${moduleName}/private/assets`,
          `modules/${moduleName}/public/assets`,
          `modules/${moduleName}/private/assets`,
        ];
    }
  }

  private async locateFile(
    rootUri: URI,
    fileName: string,
    type: 'partial' | 'view' | 'graphql' | 'asset',
  ): Promise<string | undefined> {
    const parsed = this.parseModulePath(fileName);
    const searchPaths = this.getSearchPaths(type, parsed.isModule ? parsed.moduleName : undefined);

    let targetFile = parsed.key;
    if (type === 'partial' || type === 'view') {
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
    type: 'partial' | 'view' | 'graphql' | 'asset',
  ): Promise<string[]> {
    const parsed = this.parseModulePath(filePrefix);
    const searchPaths = this.getSearchPaths(type, parsed.isModule ? parsed.moduleName : undefined);

    const results = new Set<string>();

    const matchesType = (name: string): boolean => {
      switch (type) {
        case 'partial':
        case 'view':
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
      case 'function':
        return this.locateFile(rootUri, fileName, 'partial');

      case 'render':
      case 'include':
        return this.locateFile(rootUri, fileName, 'view');

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
        return this.listFiles(rootUri, filePrefix, 'partial');

      case 'render':
      case 'include':
        return this.listFiles(rootUri, filePrefix, 'view');

      case 'graphql':
        return this.listFiles(rootUri, filePrefix, 'graphql');

      case 'asset':
        return this.listFiles(rootUri, filePrefix, 'asset');

      default:
        return [];
    }
  }
}
