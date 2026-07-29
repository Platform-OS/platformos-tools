import { describe, expect, it } from 'vitest';
import { extractSchemaTable } from './schema-table';

describe('extractSchemaTable', () => {
  it('extracts the top-level `name:` as the table', () => {
    const content = `name: blog_post
properties:
  title:
    type: string`;
    expect(extractSchemaTable(content)).toBe('blog_post');
  });

  it('extracts `name:` regardless of key order', () => {
    const content = `properties:
  title:
    type: string
name: product`;
    expect(extractSchemaTable(content)).toBe('product');
  });

  it('returns undefined when no `name:` is declared', () => {
    const content = `properties:
  title:
    type: string`;
    expect(extractSchemaTable(content)).toBeUndefined();
  });

  it('returns undefined for an empty `name:`', () => {
    expect(extractSchemaTable('name: ""')).toBeUndefined();
  });

  it('returns undefined for a non-string `name:` (list)', () => {
    const content = `name:
  - a
  - b`;
    expect(extractSchemaTable(content)).toBeUndefined();
  });

  it('returns undefined for a non-string `name:` (mapping)', () => {
    const content = `name:
  en: blog_post`;
    expect(extractSchemaTable(content)).toBeUndefined();
  });

  it('coerces nothing — a numeric `name:` is not a string, so undefined', () => {
    expect(extractSchemaTable('name: 123')).toBeUndefined();
  });

  it('returns undefined for unparseable YAML', () => {
    expect(extractSchemaTable('name: : : not valid')).toBeUndefined();
  });

  it('returns undefined for YAML that is not a mapping (a bare scalar)', () => {
    expect(extractSchemaTable('just a string')).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(extractSchemaTable('')).toBeUndefined();
  });
});
