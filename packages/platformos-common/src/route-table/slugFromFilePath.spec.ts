import { describe, it, expect } from 'vitest';
import {
  slugFromFilePath,
  formatFromFilePath,
  effectivePageSlug,
  isDeprecatedHomeAlias,
} from './slugFromFilePath';

describe('slugFromFilePath', () => {
  it('derives / from index.html.liquid', () => {
    expect(slugFromFilePath('index.html.liquid', 'html')).toBe('/');
  });

  it('derives / from index.liquid', () => {
    expect(slugFromFilePath('index.liquid', 'html')).toBe('/');
  });

  it('derives / from home.html.liquid (deprecated alias)', () => {
    expect(slugFromFilePath('home.html.liquid', 'html')).toBe('/');
  });

  it('derives / from home.liquid (deprecated alias)', () => {
    expect(slugFromFilePath('home.liquid', 'html')).toBe('/');
  });

  it('derives about from about.html.liquid', () => {
    expect(slugFromFilePath('about.html.liquid', 'html')).toBe('about');
  });

  it('derives about from about.liquid', () => {
    expect(slugFromFilePath('about.liquid', 'html')).toBe('about');
  });

  it('derives users/show from users/show.html.liquid', () => {
    expect(slugFromFilePath('users/show.html.liquid', 'html')).toBe('users/show');
  });

  it('derives users from users/index.html.liquid', () => {
    expect(slugFromFilePath('users/index.html.liquid', 'html')).toBe('users');
  });

  it('derives users from users/index.liquid', () => {
    expect(slugFromFilePath('users/index.liquid', 'html')).toBe('users');
  });

  it('derives api/v2/data from api/v2/data.json.liquid', () => {
    expect(slugFromFilePath('api/v2/data.json.liquid', 'json')).toBe('api/v2/data');
  });

  it('derives api/v2/data from api/v2/data.liquid', () => {
    expect(slugFromFilePath('api/v2/data.liquid', 'html')).toBe('api/v2/data');
  });

  it('derives deeply/nested/path/page from deeply/nested/path/page.html.liquid', () => {
    expect(slugFromFilePath('deeply/nested/path/page.html.liquid', 'html')).toBe(
      'deeply/nested/path/page',
    );
  });

  it('derives test/abc from test/abc/index.html.liquid', () => {
    expect(slugFromFilePath('test/abc/index.html.liquid', 'html')).toBe('test/abc');
  });
});

describe('formatFromFilePath', () => {
  it('returns html for plain .liquid files', () => {
    expect(formatFromFilePath('about.liquid')).toBe('html');
  });

  it('returns html for .html.liquid files', () => {
    expect(formatFromFilePath('about.html.liquid')).toBe('html');
  });

  it('returns json for .json.liquid files', () => {
    expect(formatFromFilePath('api/data.json.liquid')).toBe('json');
  });

  it('returns xml for .xml.liquid files', () => {
    expect(formatFromFilePath('feed.xml.liquid')).toBe('xml');
  });

  it('returns csv for .csv.liquid files', () => {
    expect(formatFromFilePath('export.csv.liquid')).toBe('csv');
  });

  it('returns html for a name that is nothing but an extension', () => {
    // `File.extname('.json')` is `''` in Ruby — a leading dot starts a name, it does not
    // introduce an extension — so the engine calls this html, and so must we. Without the
    // guard this reports `json`, and the slug then strips to the empty string.
    expect(formatFromFilePath('.json.liquid')).toBe('html');
  });

  it('returns html for index.liquid', () => {
    expect(formatFromFilePath('index.liquid')).toBe('html');
  });
});

describe('effectivePageSlug', () => {
  it('derives the slug from the path when no frontmatter is present', () => {
    expect(effectivePageSlug('about.html.liquid')).toBe('about');
  });

  it('derives / from index.liquid with no frontmatter', () => {
    expect(effectivePageSlug('index.liquid')).toBe('/');
  });

  it('uses an explicit string slug override verbatim, not the path', () => {
    expect(effectivePageSlug('about.liquid', { slug: 'custom/path' })).toBe('custom/path');
  });

  it('honours an empty-string slug override verbatim', () => {
    expect(effectivePageSlug('about.liquid', { slug: '' })).toBe('');
  });

  it('coerces a numeric slug override to a string (YAML may parse it as a number)', () => {
    expect(effectivePageSlug('about.liquid', { slug: 2024 })).toBe('2024');
  });

  it('coerces a boolean slug override to a string', () => {
    expect(effectivePageSlug('about.liquid', { slug: false })).toBe('false');
  });

  it('falls back to the path-derived slug when the override is null', () => {
    expect(effectivePageSlug('about.liquid', { slug: null })).toBe('about');
  });

  it('falls back to the path-derived slug when the override is undefined', () => {
    expect(effectivePageSlug('about.liquid', { slug: undefined })).toBe('about');
  });

  it('derives the slug using the frontmatter `format` override when present', () => {
    // The filename has no format extension, so the file-derived format is html;
    // the frontmatter override selects json, which changes nothing here but is
    // the value threaded to slugFromFilePath (mirrors RouteTable).
    expect(effectivePageSlug('api/data.liquid', { format: 'json' })).toBe('api/data');
  });

  it('strips the format extension using the frontmatter `format` override', () => {
    // `data.json` under the pages dir with a `json` format override strips
    // `.json`, yielding `data` — proving the override, not the filename, drives
    // the format used for stripping.
    expect(effectivePageSlug('data.json', { format: 'json' })).toBe('data');
  });

  it('ignores a non-string frontmatter `format` and uses the file-derived format', () => {
    expect(effectivePageSlug('api/data.json.liquid', { format: 123 })).toBe('api/data');
  });

  /**
   * MEASURED by running the engine's own `Page.default_routing_options`, sliced out of
   * `app/models/page.rb` rather than retyped. The override rows are the ones that bite: the
   * existing cases above use paths where the frontmatter format AGREES with the filename, so
   * they pass just as well when the override is ignored entirely.
   */
  it('derives the slug the way the engine does', () => {
    const cases: [path: string, format: string | null, slug: string][] = [
      ['data.json.liquid', null, 'data'], // no override: the format comes from the filename
      ['data.json.liquid', 'html', 'data.json'], // override DISAGREES with the filename and wins
      ['data.json.liquid', 'json', 'data'],
      ['about.foo.liquid', 'foo', 'about'], // an override is not filtered by KNOWN_FORMATS
      ['about.foo.liquid', null, 'about.foo'], // but a file-derived format is
      ['about.liquid', null, 'about'],
      ['index.liquid', null, '/'],
      ['home.liquid', null, '/'], // the deprecated root alias
      ['blog/home.liquid', null, 'blog/home'], // nested, so not the alias
      ['test/index.liquid', null, 'test'],
      ['home/index.liquid', null, 'home'], // `/index` strips before `home` is considered
      ['.json.liquid', null, '.json'],
    ];

    expect(
      cases.map(([path, format]) => ({
        path,
        format,
        slug: effectivePageSlug(path, format === null ? null : { format }),
      })),
    ).toEqual(cases.map(([path, format, slug]) => ({ path, format, slug })));
  });
});

describe('isDeprecatedHomeAlias', () => {
  it('recognizes the alias in every extension spelling', () => {
    expect(isDeprecatedHomeAlias('home.html.liquid')).toBe(true);
    expect(isDeprecatedHomeAlias('home.liquid')).toBe(true);
    expect(isDeprecatedHomeAlias('home.json.liquid')).toBe(true);
  });

  it('accepts the logical NAME as well as the path — extension off, format kept', () => {
    expect(isDeprecatedHomeAlias('home.html')).toBe(true);
    expect(isDeprecatedHomeAlias('home')).toBe(true);
  });

  it('does not match a nested page named home — its slug is blog/home, not /', () => {
    expect(isDeprecatedHomeAlias('blog/home.html.liquid')).toBe(false);
    expect(isDeprecatedHomeAlias('blog/home')).toBe(false);
  });

  it('does not match names that merely contain home', () => {
    expect(isDeprecatedHomeAlias('homepage.liquid')).toBe(false);
    expect(isDeprecatedHomeAlias('my-home.liquid')).toBe(false);
  });

  it('does not match index — the modern spelling of the root page', () => {
    expect(isDeprecatedHomeAlias('index.html.liquid')).toBe(false);
  });
});
