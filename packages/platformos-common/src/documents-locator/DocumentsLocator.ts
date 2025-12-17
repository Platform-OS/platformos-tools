import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { URI, Utils } from 'vscode-uri';

export type NodeType = 'function' | 'render' | 'include';

export class DocumentsLocator {
    constructor(private fs: AbstractFileSystem) { }

    private async findFile(path: string): Promise<boolean> {
        let stats;
        try {
            stats = await this.fs.stat(path);
            if (stats.type === FileType.File) {
                return true;
            }
        } catch {}
        return false;
    }

    private isModule(fileName: string): [boolean, string|undefined, string|undefined] {
        const isModule = fileName.startsWith('modules/');

        if(!isModule) {
            return [false, undefined, undefined];
        }
        const fileParts = fileName.split('/');
        const moduleName = fileParts[1];
        fileName = fileParts.slice(2).join('/');

        return [true, moduleName, fileName];
    }

    private async locatePartial(rootUri: URI, fileName: string): Promise<string | undefined> {
        let modulePaths: string[] = [];
        const [isModule, moduleName, moduleFilePath] = this.isModule(fileName);
        if (isModule) {
            modulePaths = [
                `app/modules/${moduleName}/public/lib`,
                `app/modules/${moduleName}/private/lib`,
                `modules/${moduleName}/public/lib`,
                `modules/${moduleName}/private/lib`,
            ];
        }

        const defaultPaths = [
            `app/lib`,
            `app/views/partials`,
        ];

        for (const path of (isModule ? modulePaths : defaultPaths)) {
            const uri = Utils.joinPath(rootUri, path, `${isModule ? moduleFilePath : fileName}.liquid`).toString()
            const result = await this.findFile(uri);
            if (result) {
                return uri;
            }
        }
        return undefined;
    }

    private async locateView(rootUri: URI, fileName: string): Promise<string | undefined> {
        let modulePaths: string[] = [];
        const [isModule, moduleName, moduleFilePath] = this.isModule(fileName);
        if (isModule) {
            modulePaths = [
                `app/modules/${moduleName}/public/views/partials`,
                `app/modules/${moduleName}/private/views/partials`,
                `modules/${moduleName}/public/views/partials`,
                `modules/${moduleName}/private/views/partials`
            ];
        }

        const defaultPaths = [
            `app/views/partials`,
        ];

        for (const path of (isModule ? modulePaths : defaultPaths)) {
            const uri = Utils.joinPath(rootUri, path, `${isModule ? moduleFilePath : fileName}.liquid`).toString()
            const result = await this.findFile(uri);
            if (result) {
                return uri;
            }
        }
        return undefined;
    }

    async locate(rootUri: URI, nodeName: NodeType, fileName: string): Promise<string | undefined> {
        switch (nodeName) {
            case 'function':
                return await this.locatePartial(rootUri, fileName);
            case 'render':
            case 'include':
                return await this.locateView(rootUri, fileName);
            default:
                return undefined;
        }
    }
}