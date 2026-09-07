import { describe, it, expect } from 'vitest';
import { parseSlug, calculatePrecedence } from './parseSlug';

describe('parseSlug', () => {
  describe('required segments only', () => {
    it('parses root as empty', () => {
      expect(parseSlug('/')).toEqual({ requiredSegments: [], optionalGroups: [] });
    });

    it('parses empty string as empty', () => {
      expect(parseSlug('')).toEqual({ requiredSegments: [], optionalGroups: [] });
    });

    it('parses single static segment', () => {
      expect(parseSlug('about')).toEqual({
        requiredSegments: [{ type: 'static', value: 'about' }],
        optionalGroups: [],
      });
    });

    it('parses multiple static segments', () => {
      expect(parseSlug('users/show')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'users' },
          { type: 'static', value: 'show' },
        ],
        optionalGroups: [],
      });
    });

    it('parses static + param', () => {
      expect(parseSlug('users/:id')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'users' },
          { type: 'param', name: 'id' },
        ],
        optionalGroups: [],
      });
    });

    it('parses static + param + static', () => {
      expect(parseSlug('users/:id/edit')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'users' },
          { type: 'param', name: 'id' },
          { type: 'static', value: 'edit' },
        ],
        optionalGroups: [],
      });
    });

    it('parses static + wildcard', () => {
      expect(parseSlug('api/*path')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'api' },
          { type: 'wildcard', name: 'path' },
        ],
        optionalGroups: [],
      });
    });

    it('parses multiple params', () => {
      expect(parseSlug('blog/:year/:month/:slug')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'blog' },
          { type: 'param', name: 'year' },
          { type: 'param', name: 'month' },
          { type: 'param', name: 'slug' },
        ],
        optionalGroups: [],
      });
    });
  });

  describe('with optional segments', () => {
    it('parses single optional param', () => {
      expect(parseSlug('users(/:id)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'users' }],
        optionalGroups: [[{ type: 'param', name: 'id' }]],
      });
    });

    it('parses multiple optional groups', () => {
      expect(parseSlug('search(/:country)(/:city)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'search' }],
        optionalGroups: [[{ type: 'param', name: 'country' }], [{ type: 'param', name: 'city' }]],
      });
    });

    it('parses optional group with static + wildcard', () => {
      expect(parseSlug('users(/section/*)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'users' }],
        optionalGroups: [
          [
            { type: 'static', value: 'section' },
            { type: 'wildcard', name: '*' },
          ],
        ],
      });
    });

    it('parses required + optional param', () => {
      expect(parseSlug('users/:id(/:action)')).toEqual({
        requiredSegments: [
          { type: 'static', value: 'users' },
          { type: 'param', name: 'id' },
        ],
        optionalGroups: [[{ type: 'param', name: 'action' }]],
      });
    });

    it('ignores an empty group without losing the one after it', () => {
      expect(parseSlug('users()(/:id)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'users' }],
        optionalGroups: [[{ type: 'param', name: 'id' }]],
      });
    });

    it('ignores an unterminated group', () => {
      expect(parseSlug('users(/:id')).toEqual({
        requiredSegments: [{ type: 'static', value: 'users' }],
        optionalGroups: [],
      });
    });

    it('closes a group at its FIRST `)`, nested `(` included', () => {
      expect(parseSlug('users(/:a(/:b)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'users' }],
        optionalGroups: [
          [
            { type: 'param', name: 'a(' },
            { type: 'param', name: 'b' },
          ],
        ],
      });
    });

    it('parses optional version + wildcard', () => {
      expect(parseSlug('api(/:version)(/*path)')).toEqual({
        requiredSegments: [{ type: 'static', value: 'api' }],
        optionalGroups: [
          [{ type: 'param', name: 'version' }],
          [{ type: 'wildcard', name: 'path' }],
        ],
      });
    });
  });
});

describe('calculatePrecedence', () => {
  it('scores all-static slug highest', () => {
    // users/section/1: 300 * -100 + 1 (html) = -29999
    expect(calculatePrecedence('users/section/1', 'html')).toBe(-29999);
  });

  it('scores two static + one param lower', () => {
    // users/section/:id: 210 * -100 + 1 (html) = -20999
    expect(calculatePrecedence('users/section/:id', 'html')).toBe(-20999);
  });

  it('scores required + optional param', () => {
    // users/:id(/:action): 111 * -100 + 1 (html) = -11099
    expect(calculatePrecedence('users/:id(/:action)', 'html')).toBe(-11099);
  });

  it('scores single static + single param', () => {
    // users/:id: 110 * -100 + 1 (html) = -10999
    expect(calculatePrecedence('users/:id', 'html')).toBe(-10999);
  });

  it('scores single static + optional param', () => {
    // users(/:id): 101 * -100 + 1 (html) = -10099
    expect(calculatePrecedence('users(/:id)', 'html')).toBe(-10099);
  });

  it('subtracts 1 for format embedded in slug', () => {
    // users/data.json: 200 * -100 - 1 (format in slug) = -20001
    expect(calculatePrecedence('users/data.json', 'json')).toBe(-20001);
  });

  it('scores non-html format without +1', () => {
    // users/data: 200 * -100 = -20000
    expect(calculatePrecedence('users/data', 'json')).toBe(-20000);
  });

  it('scores root with adjustments', () => {
    // /: 1 * -100 + 1 (root) + 1 (html) = -98
    expect(calculatePrecedence('/', 'html')).toBe(-98);
  });

  /**
   * MEASURED by running the engine's own `calculate_precedence`, sliced out of
   * `app/models/router/route_builder/route.rb` rather than retyped. If these ever need
   * changing, re-derive them the same way — a hand-written oracle only tests the transcription.
   */
  it('scores every slug shape the way the platform engine does', () => {
    const cases: [slug: string, format: string, precedence: number][] = [
      ['a/*', 'html', -19999], // a wildcard is hardcoded: it does not start with `:`
      ['a(/*)', 'html', -19999], // and so takes no optional-group discount either
      ['*', 'html', -9999],
      [':id/*', 'html', -10999],
      ['a//b', 'html', -29999], // an interior empty component still scores 100
      ['(/:x)', 'html', -10099], // a leading empty, before an optional group
      ['a.', 'html', -10000], // a bare trailing dot IS an extension to `File.extname`
      ['..', 'html', -9999], // but a leading RUN of dots is not
      ['...', 'html', -9999],
      ['..b', 'html', -9999],
      ['a..b', 'html', -10000], // a dot after a non-dot is
      ['(.json)', 'html', -10000], // a paren is an ordinary character, not grouping to strip
      ['a/(.json)', 'html', -20000], // the same, in the last component of a path
      ['a.json/', 'html', -10000], // the engine splits on `/` dropping trailing empties,
      ['a/b.json/', 'html', -20000], // so it sees `a.json` and `b.json`, not an empty component
      ['', 'html', -99], // an empty slug is NOT root — the engine's root list holds only `/`
      ['/', 'html', -98], // root outranks the empty slug by the root adjustment
      ['/', 'json', -99],
      ['a/', 'html', -9999], // CONTROL: a trailing empty is dropped, as Ruby's split does
      ['.hidden', 'html', -9999], // CONTROL: a leading dot is not a format
      ['users/:id', 'html', -10999], // CONTROL
      ['users/:id(/:action)', 'html', -11099], // CONTROL: optional-group discount
      ['users/section/1', 'html', -29999], // CONTROL
      ['users/data.json', 'json', -20001], // CONTROL: format in the last component
    ];

    expect(
      cases.map(([slug, format]) => ({
        slug,
        format,
        precedence: calculatePrecedence(slug, format),
      })),
    ).toEqual(cases.map(([slug, format, precedence]) => ({ slug, format, precedence })));
  });

  it('more specific routes have lower (better) precedence', () => {
    const allStatic = calculatePrecedence('users/section/1', 'html');
    const oneParam = calculatePrecedence('users/section/:id', 'html');
    const twoParams = calculatePrecedence('users/:id', 'html');
    const optParam = calculatePrecedence('users(/:id)', 'html');
    const root = calculatePrecedence('/', 'html');

    expect(allStatic).toBeLessThan(oneParam);
    expect(oneParam).toBeLessThan(twoParams);
    expect(twoParams).toBeLessThan(optParam);
    expect(optParam).toBeLessThan(root);
  });
});
