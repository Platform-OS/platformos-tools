import { URI } from 'vscode-uri';
import { UriString } from './AbstractFileSystem';
import { normalizeUri } from './app/uri';

/**
 * A filesystem path in the one spelling everything downstream of it is written in: forward
 * slashes, no repeated separator, no trailing one.
 *
 * THE path normalizer, singular — the filesystem-path counterpart to `normalizeUri`, and the
 * reason no other file in this monorepo spells `.replace(/\\/g, '/')` itself (`os-path.spec.ts`
 * fails if one does). Windows hands us `\`-separated paths from `readdir`, `path.join`, `glob`
 * and `__dirname`, while every consumer here is written in forward slashes, so a path that
 * skips this step matches nothing on Windows and everything on Linux.
 *
 * Same normalization as `normalize-path`, the package pos-cli uses — separators collapse, a
 * trailing separator goes, and a `\\?\` / `\\.\` Windows namespace keeps its two leading
 * slashes — ported rather than depended on so that this browser-safe package can own the rule
 * for every package below it.
 *
 * NOT for URIs, which is why it throws on one: `file:///c:/x` would come back `file:/c:/x`, a
 * different location that still looks plausible. `normalizeUri` is the URI spelling and
 * `uriFromPath` crosses between the two.
 */
export function toPosixPath(fsPath: string): string {
  if (hasScheme(fsPath)) {
    throw new Error(
      `toPosixPath takes a filesystem path, but got the URI '${fsPath}'. ` +
        `Use normalizeUri for a URI — collapsing its slashes would change what it points at.`,
    );
  }

  if (fsPath === '/' || fsPath === '\\') return '/';
  if (fsPath.length <= 1) return fsPath;

  let path = fsPath;
  let prefix = '';
  // `\\?\C:\x` and `\\.\device\x`: the two leading slashes are part of the namespace,
  // not a repeated separator, so they survive the collapse below.
  if (path.startsWith('\\\\') && (path[2] === '?' || path[2] === '.') && path[3] === '\\') {
    path = path.slice(2);
    prefix = '//';
  }

  const segments = path.split(/[\\/]+/);
  if (segments[segments.length - 1] === '') segments.pop();
  return prefix + segments.join('/');
}

/**
 * `fsPath` expressed relative to `baseDir`, forward-slashed and without a leading
 * slash — the path spelling a monorepo guard, an offense message or a
 * `FILE_TYPE_DIRS` matcher compares on.
 *
 * The filesystem-path counterpart to `relativeUriPath`, and forgiving in the same
 * way: a path that is not under `baseDir` comes back whole (normalized) rather than
 * as a `../..` chain. `baseDir` only counts as a prefix at a segment boundary, so
 * `…/packages` is not a prefix of `…/packages-old/x`.
 */
export function relativePosixPath(fsPath: string, baseDir: string): string {
  const path = toPosixPath(fsPath);
  const base = toPosixPath(baseDir);
  if (path === base) return '';

  const prefix = base.endsWith('/') ? base : `${base}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * THE filesystem-path → URI conversion: `URI.file` for the `file://` and drive-letter
 * rules, `normalizeUri` for the one spelling the toolchain compares on.
 *
 * Every caller holding an OS path and needing a URI goes through here. The two steps
 * are not separable in practice — `URI.file(p).toString()` percent-encodes the drive
 * colon (`file:///c%3A/…`) while everything that came out of a walk, a config or an
 * `App` spells it `file:///c:/…`, so a caller that stops after `URI.file` compares
 * two different strings for one file and only finds out on Windows.
 */
export function uriFromPath(fsPath: string): UriString {
  return normalizeUri(URI.file(fsPath));
}

/**
 * The same answer for a caller that cannot tell which of the two it was handed —
 * `config.ignore` subjects, a CLI argument, anything crossing a public API.
 *
 * A scheme of two or more characters means it is already a URI (`file:///…`,
 * `mock-fs:/…`); anything else — `/home/u/project/x`, `c:\project\x`, whose
 * one-letter "scheme" is a drive — is a filesystem path.
 */
export function uriFromPathOrUri(pathOrUri: string): UriString {
  return hasScheme(pathOrUri) ? normalizeUri(pathOrUri) : uriFromPath(pathOrUri);
}

function hasScheme(pathOrUri: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(pathOrUri);
}
