import { URI, Utils } from 'vscode-uri';
import { UriString } from '../AbstractFileSystem';

/**
 * A `file://` URI in the one spelling the whole toolchain compares on: forward
 * slashes, no trailing slash, no percent-encoding surprises.
 *
 * THE URI normalizer, singular. `platformos-check-common`'s `path.normalize` /
 * `path.relative` / `path.join` delegate to these three; a second implementation that
 * differs on so much as a trailing slash builds two `App`s for one project root.
 *
 * Trailing slashes are stripped from the PATH, never from the root `/` itself:
 * `…/project/` and `…/project` are one spelling, and a bare root is always
 * `scheme:/` — with the slash, because a join onto `scheme:` loses the path's
 * leading slash for every scheme but `file:`, and in one spelling, because
 * `scheme:` and `scheme:/` as two map keys is two `App`s for one project.
 */
export function normalizeUri(uri: UriString | URI): UriString {
  const parsed = URI.isUri(uri) ? uri : URI.parse(uri);
  const stripped = parsed.path.replace(/\/+$/, '');
  const path = stripped === '' ? '/' : stripped;
  const withPath = path === parsed.path ? parsed : parsed.with({ path });
  return withPath.toString(true).replace(/\\/g, '/');
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
