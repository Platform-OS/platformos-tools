import { UriString } from '@platformos/platformos-common';
import * as path from './path';

type FileExists = (uri: string) => Promise<boolean>;

async function isRoot(dir: UriString, fileExists: FileExists) {
  return or(
    // .pos config file and app directory exists
    and(
      fileExists(path.join(dir, '.pos')),
      fileExists(path.join(dir, 'app')),
      fileExists(path.join(dir, 'modules')),
      fileExists(path.join(dir, '.git')),
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

async function not(ap: Promise<boolean>) {
  const a = await ap;
  return !a;
}

/**
 * Returns the "root" of a theme or theme app extension. The root is the
 * directory that contains a `.theme-check.yml` file, a `.git` directory, or a
 * `shopify.extension.toml` file.
 *
 * There are cases where .theme-check.yml is not defined and we have to infer the root.
 * We'll assume that the root is the directory that contains a `snippets` directory.
 *
 * So you can think of this function as the function that infers where a .theme-check.yml
 * should be.
 *
 * Note: that this is not the theme root. The config file might have a `root` entry in it
 * that points to somewhere else.
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
