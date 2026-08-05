import { PlatformOSFileType } from '@platformos/platformos-common';

export type FindAppRootURI = (uri: string) => Promise<string | null>;

/**
 * THE language server's classifier: what the platform does with the file at
 * `uri`, or `undefined` when no app root covers it (one spelling of "no root",
 * for every consumer). Implemented by `DocumentManager.fileType` — providers
 * take this rather than `FindAppRootURI`, so classification happens in one
 * place and is synchronous-fast for any URI under a known root.
 */
export type FileTypeForURI = (uri: string) => Promise<PlatformOSFileType | undefined>;
