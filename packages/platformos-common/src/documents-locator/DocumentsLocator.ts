import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { URI, Utils } from 'vscode-uri';

export type DocumentType = 'function' | 'render' | 'include';

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

        return key
            ? { isModule: true, moduleName, key }
            : { isModule: false, key: fileName };
    }

    private getSearchPaths(
        type: 'partial' | 'view',
        moduleName?: string
    ): string[] {
        if (!moduleName) {
            return type === 'partial'
                ? ['app/lib']
                : ['app/views/partials'];
        }

        if (type === 'partial') {
            return [
                `app/modules/${moduleName}/public/lib`,
                `app/modules/${moduleName}/private/lib`,
                `modules/${moduleName}/public/lib`,
                `modules/${moduleName}/private/lib`,
            ];
        }

        return [
            `app/modules/${moduleName}/public/views/partials`,
            `app/modules/${moduleName}/private/views/partials`,
            `modules/${moduleName}/public/views/partials`,
            `modules/${moduleName}/private/views/partials`,
        ];
    }

    private async locateFile(
        rootUri: URI,
        fileName: string,
        type: 'partial' | 'view'
    ): Promise<string | undefined> {
        const parsed = this.parseModulePath(fileName);
        const searchPaths = this.getSearchPaths(
            type,
            parsed.isModule ? parsed.moduleName : undefined
        );

        for (const basePath of searchPaths) {
            const uri = Utils.joinPath(
                rootUri,
                basePath,
                `${parsed.key}.liquid`
            ).toString();

            if (await this.isFile(uri)) {
                return uri;
            }
        }

        return undefined;
    }

    async locate(
        rootUri: URI,
        nodeName: DocumentType,
        fileName: string
    ): Promise<string | undefined> {
        switch (nodeName) {
            case 'function':
                return this.locateFile(rootUri, fileName, 'partial');

            case 'render':
            case 'include':
                return this.locateFile(rootUri, fileName, 'view');

            default:
                return undefined;
        }
    }
}
