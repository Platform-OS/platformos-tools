import { AbstractFileSystem, FileTuple, FileType } from '@platformos/theme-check-common';
import { URI, Utils } from 'vscode-uri';

export class DocumentsLocator {
    constructor(private fs: AbstractFileSystem) { }

    async findFile(dir: URI, fileName: string): Promise<string | undefined> {
        let entries: FileTuple[];
        try {
            entries = await this.fs.readDirectory(dir.toString());
        } catch (err) {
            return undefined;
        }

        for (const [path] of entries) {
            let stats;
            try {
                stats = await this.fs.stat(path);
            } catch {
                continue;
            }

            if (stats.type === FileType.File && path.endsWith(fileName)) {
                return path;
            } else if (stats.type === FileType.Directory) {
                const found = this.findFile(URI.file(path), fileName);
                if (found) {
                    return found;
                }
            }
        }

        return undefined;
    }

    private async locateFunction(rootUri: URI, fileName: string): Promise<string | undefined> {
        const pathsToCheck = [
            `app/`,
            `modules/`
        ];

        for (const path of pathsToCheck) {
            const result = await this.findFile(Utils.joinPath(rootUri, path), `${fileName}.liquid`);
            if (result) {
                return result;
            }
        }
        return undefined;
    }

    async locate(rootUri: URI, nodeName: string, fileName: string): Promise<string | undefined> {
        switch (nodeName) {
            case 'function':
                return await this.locateFunction(rootUri, fileName)
            default:
                return undefined
        }
    }
}