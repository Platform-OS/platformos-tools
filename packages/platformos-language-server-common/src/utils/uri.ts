import { fileTypeSupportsLiquidDoc, path } from '@platformos/platformos-check-common';
import { isPartial, PlatformOSFileType, getFileType } from '@platformos/platformos-common';
import { FileTypeForURI } from '../internal-types';

export { isPartial };

export const partialName = (uri: string) => path.basename(uri, '.liquid');

// asset urls have their `.liquid` removed (if present) and require the other extension
export const assetName = (uri: string) => path.basename(uri, '.liquid');
/**
 * Whether `uri` is an asset, anchored at its app root. The root is required for the
 * same reason it is everywhere else: an asset is a file under `{root}/app/assets/`,
 * not any path with `assets/` somewhere in it.
 */
export const isAsset = (uri: string, rootUri: string) =>
  getFileType(uri, rootUri) === PlatformOSFileType.Asset;

/**
 * "Is the file at `uri` one `{% doc %}` applies to — a partial?", for a provider
 * that was handed THE classifier (`DocumentManager.fileType` — see
 * {@link FileTypeForURI}). Which types `{% doc %}` applies to stays check-common's
 * rule; where a bare URI's type comes from stays the classifier's. Without one the
 * question is unanswerable, and a provider that cannot tell a partial from a page
 * offers nothing rather than guessing.
 */
export const makeSupportsLiquidDoc =
  (fileTypeForURI?: FileTypeForURI) =>
  async (uri: string): Promise<boolean> =>
    fileTypeSupportsLiquidDoc(await fileTypeForURI?.(uri));
