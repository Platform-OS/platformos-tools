import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';

import { joinUri, normalizeUri, relativeUriPath } from '@platformos/platformos-common';
import { childUri, fsPath, join, normalize, relative, toUri } from './path';

/**
 * These pin the conversion that used to be hand-rolled at every call site.
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
    // Stated as uri -> fsPath -> uri, NOT as a string comparison against the input
    // path. `fsPath` returns a NATIVE filesystem path, so on Windows it is
    // `\srv\app\...`; asserting the POSIX spelling asserted the host platform rather
    // than the inverse relationship these two functions actually promise.
    const uri = toUri('/srv/app/views/pages/index.liquid');

    expect(toUri(fsPath(uri))).toEqual(uri);
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

/**
 * `childUri` exists only to be `join` without the parse/serialize round trip, so the
 * property that matters is that it IS `join` — pinned against `join` itself for every
 * name shape a directory listing can produce, rather than restating the encoding
 * rules and hoping the two spellings agree.
 */
describe('childUri is join, for one directory-entry name', () => {
  const names = [
    'page.liquid',
    'with space.liquid',
    'hash#tag.liquid',
    'question?mark.liquid',
    'percent%20.liquid',
    'plus+sign.liquid',
    'żółć.liquid',
    "quote's.liquid",
    'semi;colon.liquid',
    'at@sign.liquid',
    'brackets[1].liquid',
    'back\\slash.liquid',
    'dot.dir',
    '.hidden.liquid',
  ];

  const dirs = [
    'file:///project/app/views/partials',
    'file:///project',
    'file:///',
    'mock-fs:/app/views/partials',
  ];

  for (const dir of dirs) {
    it(`agrees with join under ${dir}`, () => {
      expect(names.map((name) => childUri(dir, name))).toEqual(
        names.map((name) => join(dir, name)),
      );
    });
  }
});

/**
 * There is ONE URI normalizer in the monorepo — platformos-common's `normalizeUri`
 * family — and this module's `normalize`/`relative`/`join` are its historical names.
 * These pins are the regression guard for the bug the second implementation caused:
 * the two differed on a trailing slash, so a root spelled `…/project/` and
 * `…/project` keyed two `App`s for one project and buffer diagnostics went missing.
 */
describe('normalize/relative/join are normalizeUri/relativeUriPath/joinUri', () => {
  it('normalizes a root with a trailing slash to the same string', () => {
    expect(normalize('file:///home/user/project/')).toEqual('file:///home/user/project');
    expect(normalizeUri('file:///home/user/project/')).toEqual('file:///home/user/project');
  });

  it('normalizes a percent-encoded path to the same string', () => {
    expect(normalize('file:///c%3A/project/x.liquid')).toEqual('file:///c:/project/x.liquid');
    expect(normalizeUri('file:///c%3A/project/x.liquid')).toEqual('file:///c:/project/x.liquid');
  });

  it('normalizes a Windows backslash path to the same string', () => {
    expect(normalize('file:///C:\\project\\views\\x.liquid')).toEqual(
      'file:///c:/project/views/x.liquid',
    );
    expect(normalizeUri('file:///C:\\project\\views\\x.liquid')).toEqual(
      'file:///c:/project/views/x.liquid',
    );
  });

  it('resolves a relative path identically through both entry points', () => {
    expect(relative('file:///project/app/views/pages/x.liquid', 'file:///project/')).toEqual(
      'app/views/pages/x.liquid',
    );
    expect(relativeUriPath('file:///project/app/views/pages/x.liquid', 'file:///project/')).toEqual(
      'app/views/pages/x.liquid',
    );
  });

  it('joins identically through both entry points, whichever way the root is spelled', () => {
    expect(join('file:///project/', 'app', 'x.liquid')).toEqual('file:///project/app/x.liquid');
    expect(joinUri('file:///project/', 'app', 'x.liquid')).toEqual('file:///project/app/x.liquid');
    expect(join('file:///project', 'app', 'x.liquid')).toEqual('file:///project/app/x.liquid');
    expect(joinUri('file:///project', 'app', 'x.liquid')).toEqual('file:///project/app/x.liquid');
  });
});
