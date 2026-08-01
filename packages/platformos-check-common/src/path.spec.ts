import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';

import { fsPath, normalize, relative, toUri } from './path';

/**
 * These pin the conversion that used to be hand-rolled at every call site.
 *
 * The DRIVE-COLON case runs meaningfully on any host: `vscode-uri` decides to
 * percent-encode from the path's shape, not from `process.platform`, so the exact
 * divergence that broke Windows CI is reproducible here. That matters — a guard that
 * only ran on Windows would not have caught this before it shipped.
 *
 * Separator handling is genuinely host-dependent and is asserted separately below.
 */
describe('Unit: toUri', () => {
  it('does NOT percent-encode a Windows drive colon, unlike URI.file().toString()', () => {
    // The whole reason this helper exists, and it reproduces on POSIX: `.toString()`
    // yields `file:///c%3A/...`, which compares unequal to every key built through
    // `toUri` / `normalize`. A `Map` keyed on one and read with the other misses.
    expect(toUri('c:/srv/app/index.liquid')).toEqual('file:///c:/srv/app/index.liquid');
    expect(URI.file('c:/srv/app/index.liquid').toString()).toEqual(
      'file:///c%3A/srv/app/index.liquid',
    );
  });

  it('yields forward slashes for a backslash path on either platform', () => {
    // Two different mechanisms reach the same result, which is why this is asserted
    // rather than assumed: on Windows `URI.file` converts the separators itself; on
    // POSIX it treats `\` as an ordinary filename character and `normalize`'s
    // trailing replace converts them.
    expect(toUri('c:\\srv\\app\\views\\pages\\index.liquid')).toEqual(
      'file:///c:/srv/app/views/pages/index.liquid',
    );
  });

  it('leaves a POSIX path alone beyond the scheme', () => {
    expect(toUri('/srv/app/views/pages/index.liquid')).toEqual(
      'file:///srv/app/views/pages/index.liquid',
    );
  });

  it('agrees with the hand-rolled normalize(URI.file(...)) it replaces', () => {
    // Migrating the ~26 call sites had to be a pure rename, so this compares against
    // the old spelling written out longhand. Do NOT rewrite the right-hand side to
    // `toUri` — that turns the assertion into a tautology and stops it proving
    // anything about the migration.
    for (const path of ['/srv/app/a.liquid', 'c:\\srv\\app\\a.liquid', '/srv/app/with space.yml']) {
      expect(toUri(path)).toEqual(normalize(URI.file(path)));
    }
  });

  it('round-trips through fsPath, its documented inverse', () => {
    expect(fsPath(toUri('/srv/app/views/pages/index.liquid'))).toEqual(
      '/srv/app/views/pages/index.liquid',
    );
  });

  it('is idempotent under normalize, so a key cannot drift by being normalized twice', () => {
    const uri = toUri('c:\\srv\\app\\index.liquid');

    expect(normalize(uri)).toEqual(uri);
  });

  it('produces keys that `relative` can strip a root from, on both platforms', () => {
    // The two helpers are used together to build the `getDocDefinition` map keys, so
    // they have to agree about what a root prefix looks like.
    expect(relative(toUri('c:\\srv\\app\\views\\pages\\a.liquid'), toUri('c:\\srv\\app'))).toEqual(
      'views/pages/a.liquid',
    );
    expect(relative(toUri('/srv/app/views/pages/a.liquid'), toUri('/srv/app'))).toEqual(
      'views/pages/a.liquid',
    );
  });
});
