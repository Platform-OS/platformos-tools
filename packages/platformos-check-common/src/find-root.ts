import {
  APP_ROOTS,
  APP_SOURCE_SUBTREES,
  STANDALONE_MODULE_ROOTS,
  UriString,
} from '@platformos/platformos-common';
import * as path from './path';

type FileExists = (uri: string) => Promise<boolean>;

/**
 * The directories whose mere presence marks their parent as a project root — as
 * opposed to `.pos` / `.platformos-check.yml`, which say so explicitly.
 */
const MARKER_DIRECTORIES: readonly string[] = [...APP_ROOTS, ...STANDALONE_MODULE_ROOTS];

/** {@link APP_SOURCE_SUBTREES} as segment lists; `*` matches exactly one segment. */
const SOURCE_SUBTREE_PATTERNS: readonly string[][] = APP_SOURCE_SUBTREES.map((subtree) =>
  subtree.split('/'),
);

/** The path segments of `dir`, outermost first. */
function segments(dir: UriString): string[] {
  const parts: string[] = [];
  let current = dir;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) return parts;
    parts.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * Whether `dir` is inside (or is) some project's own source subtree — `app/`,
 * `marketplace_builder/`, `modules/<name>/{public,private}/`.
 *
 * A marker DIRECTORY found in such a place names a page, a partial or a module directory, never
 * a project. Real projects have all of these — nine of the apps this was measured against
 * contain `app/views/pages/app/` or `app/views/partials/app/` — and every file beside one
 * resolved its root to the directory ABOVE it, so `{% include "api/auth/login" %}` pointed at a
 * path that cannot exist.
 */
function isInsideSourceSubtree(dir: UriString): boolean {
  const parts = segments(dir);
  return SOURCE_SUBTREE_PATTERNS.some((pattern) =>
    parts.some(
      (_, i) =>
        i + pattern.length <= parts.length &&
        pattern.every((segment, j) => segment === '*' || parts[i + j] === segment),
    ),
  );
}

async function isRoot(dir: UriString, fileExists: FileExists) {
  const markerDirectoriesCount = !isInsideSourceSubtree(dir);
  return or(
    fileExists(path.join(dir, '.pos')),
    fileExists(path.join(dir, '.platformos-check.yml')),
    ...(markerDirectoriesCount
      ? MARKER_DIRECTORIES.map((root) => fileExists(path.join(dir, root)))
      : []),
  );
}

async function or(...promises: Promise<boolean>[]) {
  const bools = await Promise.all(promises);
  return bools.reduce((a, b) => a || b, false);
}

/**
 * Returns the root of a platformOS app. The root is the directory that contains a `.pos`
 * sentinel file, a `.platformos-check.yml` config file, an app root directory (`app/`, or the
 * legacy `marketplace_builder/` — `APP_ROOTS`), or a `modules/` directory.
 *
 * A marker DIRECTORY only counts outside a project's own source subtree — see
 * {@link isInsideSourceSubtree}. A `.pos` or a config file is not subject to that: it is an
 * explicit statement, so a deliberately nested project keeps its own root wherever it is put.
 *
 * This is not the app root itself — the config file may have a `root` entry pointing elsewhere.
 */
export async function findRoot(curr: UriString, fileExists: FileExists): Promise<UriString | null> {
  const currIsRoot = await isRoot(curr, fileExists);
  if (currIsRoot) {
    return curr;
  }

  const dir = path.dirname(curr);
  const currIsAbsoluteRoot = dir === curr;
  if (currIsAbsoluteRoot) {
    return null; // Root not found.
  }

  return findRoot(dir, fileExists);
}
