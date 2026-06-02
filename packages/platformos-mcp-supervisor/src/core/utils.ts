import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import normalize from 'normalize-path';

/**
 * Convert an absolute filesystem path to an RFC 8089 `file:` URI.
 *
 * Uses `pathToFileURL` rather than string concatenation so Windows paths
 * (`C:\Users\...`) produce a valid URI. The LSP rejects malformed URIs
 * silently (no diagnostics returned), so this is load-bearing on Windows.
 *
 * Pass-through for already-URI inputs preserves the prior contract.
 */
export function toUri(p: string): string {
  if (p.startsWith('file://')) return p;
  return pathToFileURL(p).href;
}

/**
 * Normalise a filesystem path to POSIX-style forward slashes.
 *
 * Used wherever a path becomes part of a stable identifier — object keys,
 * Set/Map keys, JSON output, regex anchors. On Linux this is a no-op; on
 * Windows it converts `subdir\file.liquid` to `subdir/file.liquid` so that
 * downstream code can assume one separator everywhere and keys round-trip
 * identically across hosts.
 *
 * NEVER use this for an actual fs operation; always pass native paths to
 * `fs.readFile`, `fs.existsSync`, etc. Also do NOT call this on URI strings
 * (`file://...`) — `normalize-path` collapses adjacent slashes which corrupts
 * URI authority semantics.
 */
export function toPosixPath(p: string): string {
  return normalize(p);
}

/**
 * Validate a file path against a project root and resolve it to an absolute
 * path. Throws if the path escapes the project directory (../traversal).
 */
export function sanitizePath(directory: string, filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_path is required and must be a non-empty string');
  }
  const abs = resolve(directory, filePath);
  const rel = relative(directory, abs);
  if (rel.startsWith('..') || resolve(abs) !== abs) {
    throw new Error(`file_path must be within the project directory (resolved to ${abs})`);
  }
  return abs;
}
