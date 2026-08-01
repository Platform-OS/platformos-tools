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

/**
 * A filesystem path -> the canonical `UriString` this codebase keys on. The inverse
 * of {@link fsPath}, and the ONLY correct spelling of that conversion.
 *
 * `URI.file(p).toString()` is NOT equivalent and must never be used for a key: it
 * percent-encodes, so a Windows drive colon becomes `file:///c%3A/...` while
 * everything built through here is `file:///c:/...`. On POSIX the two are identical,
 * which is precisely what makes the difference dangerous — it is invisible until the
 * code reaches Windows, and then it surfaces as a `Map.get` that silently misses.
 *
 * That is not hypothetical. Before this helper existed the conversion was hand-rolled
 * at ~26 call sites, and three of them picked the encoding spelling: the `lintBuffers`
 * result keys, the `getDocDefinition` map root, and a graph test helper. The first
 * reported "no offenses" for files that had them; the second made every partial's
 * declared `{% doc %}` params invisible on Windows, so `MissingRenderPartialArguments`
 * — a check the MCP supervisor BLOCKS writes on — could never fire there.
 *
 * One name for the conversion is what keeps that from happening a fourth time.
 */
export function toUri(fsPath: string): UriString {
  return normalize(URI.file(fsPath));
}

function asUri(uri: UriString | URI): URI {
  return URI.isUri(uri) ? uri : URI.parse(uri);
}
