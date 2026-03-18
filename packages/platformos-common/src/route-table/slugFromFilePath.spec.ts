import { describe, it, expect } from 'vitest';
import { slugFromFilePath, formatFromFilePath } from './slugFromFilePath';

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
