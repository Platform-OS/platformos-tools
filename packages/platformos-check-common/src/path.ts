import { RelativePath, UriString } from './types';
import { URI, Utils } from 'vscode-uri';
export {
  isPartial,
  isLayout,
  isPage,
  isAuthorization,
  isEmail,
  isApiCall,
  isSms,
  isMigration,
  isFormConfiguration,
  isKnownLiquidFile,
  isKnownGraphQLFile,
  getFileType,
  getAppPaths,
  getModulePaths,
  PlatformOSFileType,
  FILE_TYPE_DIRS,
} from '@platformos/platformos-common';

export { URI, Utils };

export function relative(uri: UriString | URI, rootUri: UriString): RelativePath {
  return normalize(uri)
    .replace(rootUri, '')
    .replace(/\\\\/g, '/') // We expect forward slash paths (windows path get normalized)
    .replace(/^\/+/, '');
}

export function join(rootUri: UriString | URI, ...paths: string[]): string {
  return normalize(Utils.joinPath(asUri(rootUri), ...paths));
}

/**
 * `join(dirUri, name)` for ONE directory-entry name, without parsing and
 * re-serializing the URI.
 *
 * A filesystem adapter calls this once per entry of every directory it lists —
 * hundreds of thousands of times over a project walk, most of them for files the
 * caller then discards — and `join`'s `URI.parse` + `toString` round trip is most
 * of what a walk costs. `dirUri` must already be normalized, which is true of
 * anything that came out of `normalize`, `join` or this function.
 *
 * `childUri(dir, name) === join(dir, name)` for every name a `readdir` can return;
 * `path.spec.ts` pins that against `join` itself rather than restating the rule.
 */
export function childUri(dirUri: UriString, name: string): UriString {
  const base = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  // `toString(true)` leaves a URI path alone except for `#` and `?`, which would
  // otherwise start a fragment or a query; `normalize` then forward-slashes the
  // separators Windows produces.
  return base + (/[#?\\]/.test(name) ? encodeEntryName(name) : name);
}

function encodeEntryName(name: string): string {
  return name.replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/\\/g, '/');
}

export function resolve(uri: UriString | URI, path: string): string {
  return normalize(Utils.resolvePath(asUri(uri), path));
}

export function normalize(uri: UriString | URI): UriString {
  const normalized = asUri(uri).toString(true);
  // On Windows machines, paths use backslash ('\') as separator
  // This causes issues since backslashes in glob patterns are treated as escape characters
  // and in various URI contexts, forward slashes are expected
  // We replace all backslashes with forward slashes for cross-platform consistency
  return normalized.replace(/\\/g, '/');
}

export function dirname(uri: UriString | URI): UriString {
  return normalize(Utils.dirname(asUri(uri)));
}

export function basename(uri: UriString | URI, ext?: string): string {
  const base = Utils.basename(asUri(uri));
  return ext ? base.replace(new RegExp(`${ext.replace(/\./g, '\\.')}$`), '') : base;
}

export function fsPath(uri: UriString | URI): string {
  return asUri(uri).fsPath;
}

function asUri(uri: UriString | URI): URI {
  return URI.isUri(uri) ? uri : URI.parse(uri);
}
