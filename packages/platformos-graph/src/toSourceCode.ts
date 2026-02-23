import {
  asError,
  toSourceCode as tcToSourceCode,
  UriString,
} from '@platformos/platformos-check-common';
import { parse as acornParse, Program } from 'acorn';
import { AssetSourceCode, FileSourceCode, SUPPORTED_ASSET_IMAGE_EXTENSIONS } from './types';
import { extname } from './utils';

export function parseJs(source: string): Program | Error {
  try {
    return acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (error) {
    return asError(error);
  }
}

export async function toSourceCode(uri: UriString, source: string): Promise<FileSourceCode> {
  const extension = extname(uri);

  if (
    extension === 'json' ||
    extension === 'liquid' ||
    extension === 'graphql' ||
    extension === 'yml' ||
    extension === 'yaml'
  ) {
    return tcToSourceCode(uri, source);
  }

  const ast: Program | Error =
    extension === 'js' ? parseJs(source) : new Error('File parsing not implemented');

  const assetSourceCode: AssetSourceCode = { type: 'asset', uri, source, ast };
  return assetSourceCode;
}
