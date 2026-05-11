import { UriString } from '@platformos/platformos-common';
import * as path from './path';

type FileExists = (uri: string) => Promise<boolean>;

function isInsideApp(dir: UriString): boolean {
  let current = dir;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    if (path.basename(parent) === 'app') return true;
    current = parent;
  }
}

async function isRoot(dir: UriString, fileExists: FileExists) {
  return or(
    fileExists(path.join(dir, '.pos')),
    fileExists(path.join(dir, '.platformos-check.yml')),
    fileExists(path.join(dir, 'app')),
    // modules/ is a root indicator only when not inside an app/ subtree.
    // app/modules/ is a valid subdirectory, and app/views/partials/modules/ is a
    // legitimate partial organization that should not be mistaken for a project root.
    and(
      fileExists(path.join(dir, 'modules')),
      Promise.resolve(path.basename(dir) !== 'app' && !isInsideApp(dir)),
    ),
  );
}

async function and(...promises: Promise<boolean>[]) {
  const bools = await Promise.all(promises);
  return bools.reduce((a, b) => a && b, true);
}

async function or(...promises: Promise<boolean>[]) {
  const bools = await Promise.all(promises);
  return bools.reduce((a, b) => a || b, false);
}

/**
 * Returns the root of a platformOS app. The root is the directory that contains
 * a `.pos` sentinel file, a `.platformos-check.yml` config file, an `app/` directory,
 * or a `modules/` directory (when not inside `app/`).
 *
 * Note: `modules/` inside `app/` (i.e. `app/modules/`) is a valid subdirectory and
 * should not be treated as a root indicator.
 *
 * Note: this is not the app root itself. The config file might have a `root` entry that
 * points to somewhere else.
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
