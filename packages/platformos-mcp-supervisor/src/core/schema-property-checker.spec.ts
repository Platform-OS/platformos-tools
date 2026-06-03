import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkSchemaProperties,
  extractTableNames,
  resolveTableFromPath,
  loadSchemas,
} from './schema-property-checker';

describe('schema-property-checker', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-schema-prop-'));
    const schemaDir = join(projectDir, 'app', 'schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(
      join(schemaDir, 'blog_post.yml'),
      ['name: blog_post', 'properties:', '  - name: title', '    type: string'].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('checkSchemaProperties', () => {
    it('warns when a GraphQL accessor references an undefined schema property', () => {
      const content = [
        'query BlogPosts {',
        '  records(per_page: 10, filter: { table: { value: "blog_post" } }) {',
        '    results {',
        '      headline: property(name: "headline")',
        '    }',
        '  }',
        '}',
      ].join('\n');

      const { warnings } = checkSchemaProperties(
        content,
        'app/graphql/blog_posts/all.graphql',
        projectDir,
      );

      const unknown = warnings.filter((w) => w.check === 'pos-supervisor:UnknownSchemaProperty');
      expect(unknown.length).toBeGreaterThanOrEqual(1);
      expect(unknown[0]!.message).toMatch(/`headline`/);
      expect(unknown[0]!.message).toMatch(/`blog_post`/);
      expect(unknown[0]!.message).toMatch(/title/);
    });

    it('warns on accessor-type mismatch (integer property accessed via `property`)', () => {
      const schemaDir = join(projectDir, 'app', 'schema');
      writeFileSync(
        join(schemaDir, 'blog_post.yml'),
        ['name: blog_post', 'properties:', '  - name: views', '    type: integer'].join('\n'),
        'utf8',
      );

      const content =
        'query { records(filter: { table: { value: "blog_post" } }) { results { views: property(name: "views") } } }';

      const { warnings } = checkSchemaProperties(
        content,
        'app/graphql/blog_posts/all.graphql',
        projectDir,
      );

      const mismatch = warnings.filter(
        (w) => w.check === 'pos-supervisor:SchemaPropertyTypeMismatch',
      );
      expect(mismatch.length).toBe(1);
      expect(mismatch[0]!.message).toMatch(/`property_int`/);
      expect(mismatch[0]!.message).toMatch(/found `property`/);
    });

    it('ignores built-in fields (id, created_at, …)', () => {
      const content =
        'query { records(filter: { table: { value: "blog_post" } }) { results { id: property(name: "id") created_at: property(name: "created_at") } } }';

      const { warnings } = checkSchemaProperties(
        content,
        'app/graphql/blog_posts/all.graphql',
        projectDir,
      );

      expect(warnings).toEqual([]);
    });

    it('returns no warnings when projectDir is missing', () => {
      const { warnings } = checkSchemaProperties(
        'property(name: "missing")',
        'app/graphql/blog_posts/all.graphql',
        '',
      );
      expect(warnings).toEqual([]);
    });

    it('flags mutation property writes against the wrong value_key', () => {
      const schemaDir = join(projectDir, 'app', 'schema');
      writeFileSync(
        join(schemaDir, 'blog_post.yml'),
        ['name: blog_post', 'properties:', '  - name: published', '    type: boolean'].join('\n'),
        'utf8',
      );

      const content = `mutation { record_create(record: { table: "blog_post", properties: [{ name: "published", value: "true" }] }) { id } }`;

      const { warnings } = checkSchemaProperties(
        content,
        'app/graphql/blog_posts/create.graphql',
        projectDir,
      );

      const mismatch = warnings.filter(
        (w) => w.check === 'pos-supervisor:SchemaPropertyTypeMismatch',
      );
      expect(mismatch.length).toBe(1);
      expect(mismatch[0]!.message).toMatch(/`value_boolean`/);
    });
  });

  describe('extractTableNames', () => {
    it('reads `table: { value: "..." }` from filter args', () => {
      const c = 'records(filter: { table: { value: "blog_post" } })';
      expect(extractTableNames(c, 'app/graphql/blog_posts/all.graphql')).toEqual(['blog_post']);
    });

    it('falls back to the singularized parent directory name', () => {
      expect(extractTableNames('query {}', 'app/graphql/blog_posts/all.graphql')).toEqual([
        'blog_post',
      ]);
    });

    it('skips `modules/...` tables', () => {
      const c = 'records(filter: { table: { value: "modules/admin/post" } })';
      expect(extractTableNames(c, '')).toEqual([]);
    });
  });

  describe('resolveTableFromPath', () => {
    it('handles -ies → -y', () => {
      expect(resolveTableFromPath('app/graphql/categories/all.graphql')).toBe('category');
    });
    it('handles -ches', () => {
      expect(resolveTableFromPath('app/graphql/branches/all.graphql')).toBe('branch');
    });
    it('handles trivial -s', () => {
      expect(resolveTableFromPath('app/graphql/posts/all.graphql')).toBe('post');
    });
    it('returns null when path is not under app/graphql', () => {
      expect(resolveTableFromPath('src/foo/bar.graphql')).toBeNull();
    });
  });

  describe('loadSchemas', () => {
    it('loads property maps for the requested tables only', () => {
      const map = loadSchemas(projectDir, ['blog_post', 'non_existent']);
      expect(Object.keys(map)).toEqual(['blog_post']);
      expect(map.blog_post.get('title')).toBe('string');
    });

    it('returns {} when app/schema does not exist', () => {
      const empty = mkdtempSync(join(tmpdir(), 'mcp-supervisor-empty-'));
      try {
        expect(loadSchemas(empty, ['anything'])).toEqual({});
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });
});
