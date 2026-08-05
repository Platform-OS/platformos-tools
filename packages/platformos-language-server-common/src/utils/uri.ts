import { fileTypeSupportsLiquidDoc } from '@platformos/platformos-check-common';
import {
  isPartial,
  PlatformOSFileType,
  getFileType,
  uriToName,
} from '@platformos/platformos-common';
import { FileTypeForURI } from '../internal-types';

export { isPartial };

/**
 * The logical name a reference spells for the partial at `uri`, or `undefined`
 * when the file is not one — `AppFile#name` for a caller holding only a URI and
 * its root.
 *
 * Nested directories and `modules/<name>/` prefixes are PART of the name
 * (`ui/card`, `modules/core/create`), which is what the `path.basename` this
 * used to be got wrong: a rename of `views/partials/ui/card.liquid` computed
 * `card`, missed every `{% render 'ui/card' %}` call site, and rewrote a
 * top-level `card` partial's instead.
 */
export const partialName = (uri: string, rootUri: string): string | undefined => {
  const logical = uriToName(uri, rootUri);
  return logical?.fileType === PlatformOSFileType.Partial ? logical.name : undefined;
};

/**
 * The logical name of the asset at `uri`, or `undefined` when the file is not one.
 *
 * Asset names keep their FULL filename, `.liquid` included: the backend's
 * `AssetName` strips only the directory prefix (`asset_parser.rb`), so
 * `assets/theme.css.liquid` is referenced as `'theme.css.liquid' | asset_url`.
 * The `.liquid`-stripping this used to do was Shopify's rule, not platformOS's.
 */
export const assetName = (uri: string, rootUri: string): string | undefined => {
  const logical = uriToName(uri, rootUri);
  return logical?.fileType === PlatformOSFileType.Asset ? logical.name : undefined;
};

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
