import { describe, it, expect } from 'vitest';
import { validateSchema } from './schema-validator';

describe('validateSchema', () => {
  it('returns at least one error with a non-empty message for malformed YAML', () => {
    // Tab indentation inside a mapping is illegal in YAML and triggers
    // a js-yaml exception that should NOT propagate — the validator must
    // catch it and surface a structured error.
    const malformed = 'name: blog_post\nproperties:\n\t- name: title\n\t  type: string\n';

    const { errors } = validateSchema(malformed, 'app/schema/blog_post.yml');

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.check).toBe('pos-supervisor:SchemaYAML');
    expect(errors[0]!.severity).toBe('error');
    expect(errors[0]!.message).toMatch(/Invalid YAML syntax:/);
    expect(errors[0]!.message.length).toBeGreaterThan('Invalid YAML syntax: '.length);
  });

  it('flags misleading property keys as errors', () => {
    const yaml = [
      'name: blog_post',
      'properties:',
      '  - name: title',
      '    type: string',
      '    required: true',
    ].join('\n');

    const { errors } = validateSchema(yaml, 'app/schema/blog_post.yml');

    expect(errors.some((e) => e.message.includes('`required` is not a schema-level concept'))).toBe(true);
  });

  it('warns when name does not match filename', () => {
    const yaml = ['name: wrong_name', 'properties:', '  - name: title', '    type: string'].join('\n');

    const { warnings } = validateSchema(yaml, 'app/schema/blog_post.yml');

    expect(warnings.some((w) => w.check === 'pos-supervisor:SchemaNameMismatch')).toBe(true);
  });

  it('accepts a valid schema with no diagnostics', () => {
    const yaml = ['name: blog_post', 'properties:', '  - name: title', '    type: string'].join('\n');

    const { errors, warnings } = validateSchema(yaml, 'app/schema/blog_post.yml');

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
