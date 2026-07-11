import { describe, it, expect } from 'vitest';
import { slugFromFilePath, formatFromFilePath, effectivePageSlug } from './slugFromFilePath';

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
});
