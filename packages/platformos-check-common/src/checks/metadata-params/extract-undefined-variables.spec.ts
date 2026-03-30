import { describe, it, expect } from 'vitest';
import { extractUndefinedVariables } from './extract-undefined-variables';

describe('extractUndefinedVariables', () => {
  it('should return variables used but not defined', () => {
    const source = `{% liquid
      assign b = a
    %}
    {{ b }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal(['a']);
  });

  it('should not include assigned variables', () => {
    const source = `{% assign x = 1 %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should not include captured variables', () => {
    const source = `{% capture x %}hello{% endcapture %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should not include for loop variables', () => {
    const source = `{% for item in items %}{{ item }}{% endfor %}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal(['items']);
  });

  it('should not include forloop variable', () => {
    const source = `{% for item in items %}{{ forloop.index }}{% endfor %}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal(['items']);
  });

  it('should handle function result variables', () => {
    const source = `{% function res = 'my_partial' %}{{ res }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should handle graphql result variables', () => {
    const source = `{% graphql res = 'my_query' %}{{ res }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should handle parse_json result variables', () => {
    const source = `{% parse_json data %}{"a":1}{% endparse_json %}{{ data }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should not include global objects', () => {
    const source = `{{ context.session }}`;
    const result = extractUndefinedVariables(source, [
      'context',
      'null',
      'true',
      'false',
      'blank',
      'empty',
    ]);
    expect(result).to.deep.equal([]);
  });

  it('should deduplicate results', () => {
    const source = `{{ a }}{{ a }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal(['a']);
  });

  it('should return empty array if source fails to parse', () => {
    const source = `{% invalid unclosed`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should handle increment/decrement as definitions', () => {
    const source = `{% increment counter %}{{ counter }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should handle hash_assign as definition', () => {
    const source = `{% hash_assign h['key'] = 'val' %}{{ h }}`;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal([]);
  });

  it('should not include doc param names', () => {
    const source = `
      {% doc %}
        @param {String} name - a name
      {% enddoc %}
      {{ name }}
    `;
    const result = extractUndefinedVariables(source);
    expect(result).to.deep.equal(['name']);
  });
});
