import { describe, expect, it } from 'vitest';
import { extractSchemaTable, parameterizedTableName } from './schema-table';

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
name: item`;
    expect(extractSchemaTable(content)).toBe('item');
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

/**
 * The platform's `ParameterizedName`, which is what a GraphQL `table:` must spell —
 * `records_filter_input.rb` maps that argument to `parameterized_name`. Read from the platform
 * source and confirmed against real projects, which query `modules/user/profile` for a module
 * schema whose `name:` is `profile`.
 */
describe('parameterizedTableName', () => {
  it('leaves an app schema name alone', () => {
    expect(parameterizedTableName('blog_post')).toEqual('blog_post');
  });

  it('prefixes a module schema name with its module', () => {
    expect(parameterizedTableName('profile', 'user')).toEqual('modules/user/profile');
  });

  it('does not prefix twice when the name already carries the module', () => {
    expect(parameterizedTableName('modules/user/profile', 'user')).toEqual('modules/user/profile');
  });

  it('downcases and turns spaces into underscores, as the platform does', () => {
    expect(parameterizedTableName('Blog Post')).toEqual('blog_post');
    expect(parameterizedTableName('My Table', 'core')).toEqual('modules/core/my_table');
  });
});
