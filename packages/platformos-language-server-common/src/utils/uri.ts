import { path } from '@platformos/platformos-check-common';

export const partialName = (uri: string) => path.basename(uri, '.liquid');
export const isPartial = (uri: string) => /\b(partials|lib)(\\|\/)[^\\\/]*\.liquid/.test(uri);

// asset urls have their `.liquid`` removed (if present) and require the other extension */
export const assetName = (uri: string) => path.basename(uri, '.liquid');
export const isAsset = (uri: string) => /\bassets(\\|\/)[^\\\/]/.test(uri);
