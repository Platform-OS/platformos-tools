import { path } from '@platformos/platformos-check-common';
import { isPartial, PlatformOSFileType, getFileType } from '@platformos/platformos-common';

export { isPartial };

export const partialName = (uri: string) => path.basename(uri, '.liquid');

// asset urls have their `.liquid` removed (if present) and require the other extension
export const assetName = (uri: string) => path.basename(uri, '.liquid');
export const isAsset = (uri: string) => getFileType(uri) === PlatformOSFileType.Asset;
