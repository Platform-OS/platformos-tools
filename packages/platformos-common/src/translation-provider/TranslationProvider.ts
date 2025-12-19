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

    private parseModuleKey(translationKey: string): ModuleKeyInfo {
        if (!translationKey.startsWith('modules/')) {
            return { isModule: false, key: translationKey };
        }

        const [, moduleName, key] = translationKey.split('/', 3);

        return key
            ? { isModule: true, moduleName, key }
            : { isModule: false, key: translationKey };
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
        defaultLocale: string
    ): Promise<[string | undefined, string | undefined]> {
        const parsed = this.parseModuleKey(translationKey);
        const fileName = parsed.key.split('.')[0];

        if (!fileName) {
            return [undefined, undefined];
        }

        const searchPaths = this.getSearchPaths(
            parsed.isModule ? parsed.moduleName : undefined
        );

        for (const basePath of searchPaths) {
            const uri = Utils.joinPath(
                rootUri,
                basePath,
                defaultLocale,
                `${fileName}.yml`
            ).toString();

            if (await this.isFile(uri)) {
                return [uri, parsed.key];
            }
        }

        return [undefined, undefined];
    }

    async translate(
        rootUri: URI,
        translationKey: string,
        defaultLocale: string = 'en'
    ): Promise<string | undefined> {
        const [file, key] = await this.findTranslationFile(
            rootUri,
            translationKey,
            defaultLocale
        );

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
