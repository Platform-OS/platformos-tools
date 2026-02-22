import { UriString } from '@platformos/platformos-common';
import * as path from './path';

type FileExists = (uri: string) => Promise<boolean>;

async function isRoot(dir: UriString, fileExists: FileExists) {
  return or(
    fileExists(path.join(dir, '.pos')),
    fileExists(path.join(dir, 'app')),
    fileExists(path.join(dir, 'modules')),
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
 * a `.platformos-check.yml` file, a `.pos` sentinel file, an `app/` directory,
 * or a `modules/` directory.
 *
 * There are cases where `.platformos-check.yml` is not defined and we have to infer the root.
 * We assume the root is the nearest ancestor directory that contains `.pos`, `app/`, or `modules/`.
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
