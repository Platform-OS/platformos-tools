import { URI, Utils } from 'vscode-uri';
import { UriString } from '../AbstractFileSystem';

/**
 * A `file://` URI in the one spelling the whole toolchain compares on: forward
 * slashes, no trailing slash, no percent-encoding surprises.
 *
 * Deliberately the same normalization as `platformos-check-common`'s
 * `path.normalize`, which this package sits below and therefore cannot import.
 */
export function normalizeUri(uri: UriString | URI): UriString {
  const normalized = (URI.isUri(uri) ? uri : URI.parse(uri)).toString(true).replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/** `uri` expressed relative to `rootUri`, forward-slashed and without a leading slash. */
export function relativeUriPath(uri: UriString, rootUri: UriString): string {
  const normalizedUri = normalizeUri(uri);
  const normalizedRoot = normalizeUri(rootUri);
  const relative = normalizedUri.startsWith(normalizedRoot)
    ? normalizedUri.slice(normalizedRoot.length)
    : normalizedUri;
  return relative.replace(/^\/+/, '');
}

/** `rootUri` with `segments` appended, normalized. */
export function joinUri(rootUri: UriString, ...segments: string[]): UriString {
  return normalizeUri(Utils.joinPath(URI.parse(rootUri), ...segments));
}
