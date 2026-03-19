import { AbstractFileSystem } from '@platformos/platformos-common';

export class CachedFileSystem implements AbstractFileSystem {
  readFile: Cached<AbstractFileSystem['readFile']>;
  readDirectory: Cached<AbstractFileSystem['readDirectory']>;
  stat: Cached<AbstractFileSystem['stat']>;

  constructor(fs: AbstractFileSystem) {
    this.readFile = cachedByUri(
      fs.readFile.bind(fs),
      // app/config.yml can change externally (e.g. vim) without a file watcher
      // notification. Always read it fresh — it's small and rarely accessed.
      (uri) => uri.endsWith('/app/config.yml'),
    );
    this.readDirectory = cachedByUri(fs.readDirectory.bind(fs));
    this.stat = cachedByUri(fs.stat.bind(fs));
  }
}

interface Cached<Fn extends (uri: string) => Promise<any>, T = ReturnType<Fn>> {
  (uri: string): T;
  invalidate(uri: string): void;
}

function cachedByUri<T>(
  fn: (uri: string) => Promise<T>,
  skipCache?: (uri: string) => boolean,
): Cached<typeof fn> {
  const cache = new Map<string, Promise<T>>();

  function cached(uri: string) {
    if (skipCache?.(uri)) return fn(uri);
    if (!cache.has(uri)) {
      // I'm intentionally leaving this comment here for debugging purposes :)
      // console.error('cache miss', fn.name, uri);
      cache.set(uri, fn(uri));
    }
    return cache.get(uri)!;
  }

  cached.invalidate = (uri: string) => {
    // I'm intentionally leaving this comment here for debugging purposes :)
    // console.error('cache invalidate', fn.name, uri);
    cache.delete(uri);
  };

  return cached;
}
