import { path } from '@platformos/platformos-check-common';
import { isPartial, PlatformOSFileType, getFileType } from '@platformos/platformos-common';

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
