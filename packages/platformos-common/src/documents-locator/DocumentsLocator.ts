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

        return key
            ? { isModule: true, moduleName, key }
            : { isModule: false, key: fileName };
    }

    private getSearchPaths(
        type: 'partial' | 'view' | 'graphql' | 'asset',
        moduleName?: string
    ): string[] {
        if (!moduleName) {
            switch(type) {
                case 'partial':
                    return ['app/lib'];
                case 'view':
                    return ['app/views/partials'];
                case 'graphql': 
                    return ['app/graphql'];
                case 'asset':
                    return ['app/assets'];

            }
        }

        switch(type) {
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
        type: 'partial' | 'view' | 'graphql' | 'asset'
    ): Promise<string | undefined> {
        const parsed = this.parseModulePath(fileName);
        const searchPaths = this.getSearchPaths(
            type,
            parsed.isModule ? parsed.moduleName : undefined
        );
        let targetFile = parsed.key
        if (type === 'partial' || type === 'view' ) {
            targetFile += '.liquid';
        }
        else if(type === 'graphql') {
            targetFile += '.graphql'
        }

        for (const basePath of searchPaths) {           
            const uri = Utils.joinPath(
                rootUri,
                basePath,
                targetFile
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

            case 'graphql':
                return this.locateFile(rootUri, fileName, 'graphql');
            case 'asset':
                return this.locateFile(rootUri, fileName, 'asset');
            default:
                return undefined;
        }
    }
}
