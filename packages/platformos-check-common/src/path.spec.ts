import { joinUri, normalizeUri, relativeUriPath } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { childUri, join, normalize, relative } from './path';

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
