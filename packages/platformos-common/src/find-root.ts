import { AbstractFileSystem, UriString } from './AbstractFileSystem';
import { basenameUri, dirnameUri, joinUri } from './app/uri';
import { uriFromPathOrUri } from './os-path';
import { APP_ROOTS, APP_SOURCE_SUBTREES, STANDALONE_MODULE_ROOTS } from './path-utils';

/** A probe for whether a URI exists. {@link makeFileExists} builds one from a filesystem. */
export type FileExists = (uri: string) => Promise<boolean>;

/**
 * A {@link FileExists} over `fs`.
 *
 * Lives beside {@link findRoot} because that is what it exists for — walking upward asks "is there
 * a marker here?" once per candidate directory, and `stat` throwing is the only way to ask.
 */
export const makeFileExists =
  (fs: AbstractFileSystem): FileExists =>
  async function fileExists(uri: string) {
    try {
      await fs.stat(uri);
      return true;
    } catch (e) {
      return false;
    }
  };

/**
 * The directories whose mere presence marks their parent as a project root — as
 * opposed to `.pos` / `.platformos-check.yml`, which say so explicitly.
 */
const MARKER_DIRECTORIES: readonly string[] = [...APP_ROOTS, ...STANDALONE_MODULE_ROOTS];

/**
 * The files whose presence marks their directory as a project root explicitly, as opposed to the
 * marker DIRECTORIES above whose presence only implies it.
 */
const MARKER_FILES: readonly string[] = ['.pos', '.platformos-check.yml'];

/**
 * Everything {@link findRoot} looks for, for callers that need to SAY what was looked for when
 * nothing was found. Derived rather than restated, so a message cannot drift from the rule: the
 * one place this list was written out by hand — the graph CLI's error — had already diverged in
 * spirit from `isRoot` by not mentioning that a marker directory is ignored inside a source subtree.
 */
export const PROJECT_ROOT_MARKERS: readonly string[] = [
  ...MARKER_DIRECTORIES.map((dir) => `${dir}/`),
  ...MARKER_FILES,
];

/** {@link APP_SOURCE_SUBTREES} as segment lists; `*` matches exactly one segment. */
const SOURCE_SUBTREE_PATTERNS: readonly string[][] = APP_SOURCE_SUBTREES.map((subtree) =>
  subtree.split('/'),
);

/** The path segments of `dir`, outermost first. */
function segments(dir: UriString): string[] {
  const parts: string[] = [];
  let current = dir;
  while (true) {
    const parent = dirnameUri(current);
    if (parent === current) return parts;
    parts.unshift(basenameUri(current));
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
    ...MARKER_FILES.map((file) => fileExists(joinUri(dir, file))),
    ...(markerDirectoriesCount
      ? MARKER_DIRECTORIES.map((root) => fileExists(joinUri(dir, root)))
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

  const dir = dirnameUri(curr);
  const currIsAbsoluteRoot = dir === curr;
  if (currIsAbsoluteRoot) {
    return null; // Root not found.
  }

  return findRoot(dir, fileExists);
}

/** What {@link resolveProjectRoot} found out about the path it was given. */
export interface ProjectRootResolution {
  /** The argument, normalized to a URI. */
  given: UriString;
  /** The enclosing project root, or `null` when the path is not inside a project at all. */
  root: UriString | null;
  /** Whether `given` IS that root, rather than somewhere beneath it. */
  isRoot: boolean;
}

/**
 * Resolve a path to its enclosing platformOS project, and say whether the path *is* that project's
 * root — the two facts a caller needs to tell a user what to do next.
 *
 * WHY THIS RETURNS FACTS INSTEAD OF THROWING. The two callers want opposite things from the same
 * lookup. `platformos-graph` accepts being pointed anywhere inside a project, because the graph of
 * a project is the same answer wherever you point at it. The linter must NOT: `check run app`
 * silently widening to the project root would check `modules/` too, so a run meant for one app
 * would report offenses from vendored code its caller does not own. Returning `{root, isRoot}` lets
 * each decide, with one implementation of the lookup.
 *
 * The argument must be an absolute path or a URI. Resolving a cwd-relative path needs
 * `process.cwd()`, which cannot appear here — this package is also built for the browser
 * (`platformos-check-browser`, `platformos-language-server-browser`) and has no node APIs in its
 * source. Node callers resolve to absolute first; that is the only part that cannot be shared.
 *
 * @param pathOrUri - an ABSOLUTE path, or a URI
 * @param fileExists - the same probe {@link findRoot} takes
 */
export async function resolveProjectRoot(
  pathOrUri: string,
  fileExists: FileExists,
): Promise<ProjectRootResolution> {
  const given = uriFromPathOrUri(pathOrUri);
  const root = await findRoot(given, fileExists);
  return { given, root, isRoot: root === given };
}
