import { describe, expect, it, vi } from 'vitest';

import { isIgnored } from './ignore';
import { Config } from './types';

/**
 * Counts pattern compilations. A subclass rather than `vi.fn(Minimatch)`: wrapping a
 * class in `vi.fn` gives the mock its own prototype, so `new` produces an object
 * without Minimatch's methods (`this.make is not a function`). Subclassing keeps the
 * real behaviour and only observes construction.
 */
const compiled: string[] = [];

vi.mock('minimatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('minimatch')>();
  class CountingMinimatch extends actual.Minimatch {
    constructor(pattern: string, options?: object) {
      super(pattern, options);
      compiled.push(pattern);
    }
  }
  return { ...actual, Minimatch: CountingMinimatch };
});

const compileCount = () => compiled.length;

const configWith = (ignore: string[]): Config =>
  ({
    rootUri: 'file:///project',
    ignore,
    checks: [],
    settings: {},
  }) as unknown as Config;

const uri = (relativePath: string) => `file:///project/${relativePath}`;

describe('Unit: isIgnored memoization', () => {
  it('compiles each pattern once, however many paths are tested', () => {
    const config = configWith(['node_modules/**', 'dist/**']);
    const before = compileCount();

    const verdicts = [
      isIgnored(uri('app/views/pages/index.liquid'), config),
      isIgnored(uri('node_modules/x/y.liquid'), config),
      isIgnored(uri('dist/bundle.liquid'), config),
      isIgnored(uri('app/views/partials/card.liquid'), config),
      isIgnored(uri('node_modules/a/b.liquid'), config),
    ];

    // Two patterns => at most two compilations, for five paths.
    expect(compileCount() - before).toBeLessThanOrEqual(2);
    expect(verdicts).toEqual([false, true, true, false, true]);
  });

  it('does not recompile across calls with an equal but distinct config object', () => {
    // A fresh Config is built on every lint run, so memoization must key on the
    // pattern strings rather than on object identity.
    isIgnored(uri('a.liquid'), configWith(['ignored-here/**']));
    const before = compileCount();

    isIgnored(uri('b.liquid'), configWith(['ignored-here/**']));
    isIgnored(uri('c.liquid'), configWith(['ignored-here/**']));

    expect(compileCount() - before).toEqual(0);
  });

  it('honours a CHANGED ignore list rather than serving the previous verdict', () => {
    const path = uri('app/views/pages/secret.liquid');

    expect(isIgnored(path, configWith(['other/**']))).toBe(false);
    // The user edits .platformos-check.yml: no file changed, only the config.
    expect(isIgnored(path, configWith(['app/views/pages/**']))).toBe(true);
    // ...and back again.
    expect(isIgnored(path, configWith(['other/**']))).toBe(false);
  });

  it('keys on the root as well, so the same pattern under a different root is not reused', () => {
    const absolutePattern = ['/app/views/**'];
    const under = (root: string, relativePath: string) =>
      isIgnored(`${root}/${relativePath}`, {
        rootUri: root,
        ignore: absolutePattern,
        checks: [],
        settings: {},
      } as unknown as Config);

    expect(under('file:///project-a', 'app/views/x.liquid')).toBe(true);
    expect(under('file:///project-b', 'app/views/x.liquid')).toBe(true);
    // A path that only matches under the OTHER root must not be ignored here.
    expect(
      isIgnored('file:///project-a/app/views/x.liquid', {
        rootUri: 'file:///project-b',
        ignore: absolutePattern,
        checks: [],
        settings: {},
      } as unknown as Config),
    ).toBe(false);
  });

  it('keeps per-check ignore patterns separate from the global ones', () => {
    const config = {
      rootUri: 'file:///project',
      ignore: ['global/**'],
      checks: [],
      settings: { MyCheck: { ignore: ['per-check/**'] } },
    } as unknown as Config;
    const checkDef = { meta: { code: 'MyCheck' } } as never;

    // The per-check pattern applies only when the check is passed.
    expect(isIgnored(uri('per-check/a.liquid'), config)).toBe(false);
    expect(isIgnored(uri('per-check/a.liquid'), config, checkDef)).toBe(true);
    // The global pattern applies either way.
    expect(isIgnored(uri('global/a.liquid'), config)).toBe(true);
    expect(isIgnored(uri('global/a.liquid'), config, checkDef)).toBe(true);
  });

  it('compiles nothing at all when there are no patterns', () => {
    const before = compileCount();

    expect(isIgnored(uri('a.liquid'), configWith([]))).toBe(false);

    expect(compileCount() - before).toEqual(0);
  });
});
