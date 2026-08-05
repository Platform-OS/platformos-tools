import { toSourceCode as tcToSourceCode, UriString } from '@platformos/platformos-check-common';
import { sourceCodeTypeOf } from '@platformos/platformos-common';
import { AssetSourceCode, FileSourceCode } from './types';
import { graphParsers, parseJs } from './parsers';
import { extname } from './utils';

export { parseJs };

/**
 * Build a source code for a graph node from contents already in hand.
 *
 * This is the path for callers with no `App`: an in-flight editor buffer, a fixture,
 * a URI from outside the project. Callers that DO have one should pass
 * `appBackedGetSourceCode(app, …)` as `getSourceCode` instead — that is what makes a
 * graph build and a lint run share one parse per file rather than doing one each.
 *
 * The JS and image-asset parses come from {@link graphParsers}, so there is exactly
 * one definition of how each is handled whether the file arrives through the App
 * model or through here.
 */
export async function toSourceCode(uri: UriString, source: string): Promise<FileSourceCode> {
  const extension = extname(uri);

  // `sourceCodeTypeOf` is the single answer to which extensions check-common
  // parses; `.json` is the one addition, and only because `tcToSourceCode` models
  // an unrecognised buffer as JSON for the editor (see its doc comment). Anything
  // else is an asset, parsed — or not — by `graphParsers`.
  if (sourceCodeTypeOf(uri) !== undefined || extension === 'json') {
    return tcToSourceCode(uri, source);
  }

  const parse = graphParsers.extensions?.[extension];
  const ast = (
    parse ? parse(source, uri) : new Error('File parsing not implemented')
  ) as AssetSourceCode['ast'];

  const assetSourceCode: AssetSourceCode = { type: 'asset', uri, source, ast };
  return assetSourceCode;
}
