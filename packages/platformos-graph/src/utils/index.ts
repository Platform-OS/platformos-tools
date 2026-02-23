import { UriString } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function assertNever(module: never) {
  throw new Error(`Unknown module type ${module}`);
}

export const identity = <T>(x: T): T => x;

export function isString(x: unknown): x is string {
  return typeof x === 'string';
}

export function extname(uri: UriString): string {
  return uri.split('.').pop() || '';
}

export async function exists(fs: AbstractFileSystem, uri: UriString): Promise<boolean> {
  return fs
    .stat(uri)
    .then(() => true)
    .catch(() => false);
}
