import { joinUri, normalizeUri, relativeUriPath } from '@platformos/platformos-common';
import { RelativePath, UriString } from './types';
import { URI, Utils } from 'vscode-uri';

export { URI, Utils };

export function relative(uri: UriString | URI, rootUri: UriString): RelativePath {
  return relativeUriPath(normalize(uri), rootUri);
}

export function join(rootUri: UriString | URI, ...paths: string[]): string {
  return joinUri(normalize(rootUri), ...paths);
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

/**
 * `platformos-common`'s `normalizeUri`, under this module's historical name.
 *
 * One implementation, deliberately: a second normalizer disagreeing on so much as a
 * trailing slash is enough for a root spelled `…/project/` and `…/project` to key two
 * `App`s for one project (see `DocumentManager.appAt`).
 */
export function normalize(uri: UriString | URI): UriString {
  return normalizeUri(uri);
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
 * A filesystem path -> the canonical `UriString` this codebase keys on. The inverse of
 * {@link fsPath}, and the ONLY correct spelling of that conversion.
 *
 * `URI.file(p).toString()` is NOT equivalent and must never be used for a key: it
 * percent-encodes, so a Windows drive colon becomes `file:///c%3A/...` while everything built
 * through here is `file:///c:/...`. On POSIX the two are identical, which is what makes the
 * difference dangerous — it surfaces only on Windows, as a `Map.get` that silently misses.
 *
 * Not hypothetical: before this helper existed the conversion was hand-rolled at ~26 call
 * sites, and three picked the encoding spelling. One reported "no offenses" for files that had
 * them; another made every partial's declared `{% doc %}` params invisible on Windows, so a
 * check the MCP supervisor BLOCKS writes on could never fire there.
 */
export function toUri(fsPath: string): UriString {
  return normalize(URI.file(fsPath));
}

function asUri(uri: UriString | URI): URI {
  return URI.isUri(uri) ? uri : URI.parse(uri);
}
