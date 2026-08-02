import { describe, expect, it } from 'vitest';
import { childUri, join } from './path';

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
