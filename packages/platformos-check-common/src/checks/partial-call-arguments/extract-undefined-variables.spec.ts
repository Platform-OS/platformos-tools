import { describe, it, expect } from 'vitest';
import { extractUndefinedVariables } from './extract-undefined-variables';

describe('extractUndefinedVariables', () => {
  it('should return variables used but not defined', () => {
    const source = `{% liquid
      assign b = a
    %}
    {{ b }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['a']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not include assigned variables', () => {
    const source = `{% assign x = 1 %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not include captured variables', () => {
    const source = `{% capture x %}hello{% endcapture %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not include for loop variables', () => {
    const source = `{% for item in items %}{{ item }}{% endfor %}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['items']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not include forloop variable', () => {
    const source = `{% for item in items %}{{ forloop.index }}{% endfor %}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['items']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle function result variables', () => {
    const source = `{% function res = 'my_partial' %}{{ res }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle graphql result variables', () => {
    const source = `{% graphql res = 'my_query' %}{{ res }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle inline graphql result variables', () => {
    const source = `{% graphql res %}{ users { id } }{% endgraphql %}{{ res }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle parse_json result variables', () => {
    const source = `{% parse_json data %}{"a":1}{% endparse_json %}{{ data }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
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
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should deduplicate results', () => {
    const source = `{{ a }}{{ a }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['a']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should return empty arrays if source fails to parse', () => {
    const source = `{% invalid unclosed`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle increment/decrement as definitions', () => {
    const source = `{% increment counter %}{{ counter }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle background file-based result variables', () => {
    const source = `{% background my_job = 'some_partial' %}{{ my_job }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle inline background tag without job_id', () => {
    const source = `{% background source_name: 'my_task' %}echo "hello"{% endbackground %}{{ my_job }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['my_job']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not include doc param names', () => {
    const source = `
      {% doc %}
        @param {String} name - a name
      {% enddoc %}
      {{ name }}
    `;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['name']);
    expect(result.optional).to.deep.equal([]);
  });

  // | default filter detection

  it('should treat assign x = x | default: val as optional', () => {
    const source = `{% assign message = message | default: null %}{{ message }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal(['message']);
  });

  it('should treat inline output with | default as optional', () => {
    const source = `{{ message | default: 'fallback' }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal(['message']);
  });

  it('should treat only the defaulted variable as optional, not others', () => {
    const source = `
      {% liquid
        assign message = message | default: null
        assign name = name
      %}
      {{ message }}{{ name }}
    `;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['name']);
    expect(result.optional).to.deep.equal(['message']);
  });

  it('should treat x as optional when assign y = x | default: val (different lhs/rhs)', () => {
    // x is the optional input; y is the local alias defined by the assign
    const source = `{% assign label = title | default: 'Untitled' %}{{ label }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal(['title']);
  });

  it('should treat variable as optional when default filter is not first in the chain', () => {
    const source = `{% assign x = x | strip | default: '' %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal(['x']);
  });

  it('should not classify a variable as optional when default is applied to a literal, not the variable', () => {
    // default is applied to the result of upcase, not directly to the VariableLookup
    // The parent of `x` lookup here is LiquidVariable; default is still in filters — optional
    // This is the same as any other filter chain: x | upcase | default: '' → x is optional
    const source = `{% assign x = x | upcase | default: '' %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal(['x']);
  });

  it('should not treat a variable as optional when it has no default filter', () => {
    const source = `{% assign x = x | upcase %}{{ x }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['x']);
    expect(result.optional).to.deep.equal([]);
  });

  it('should not classify a defined variable as optional even when | default is used later', () => {
    // x is defined by the assign, so the later {{ x | default: '' }} does not make x an input
    const source = `{% assign x = 'hello' %}{{ x | default: 'fallback' }}`;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal([]);
    expect(result.optional).to.deep.equal([]);
  });

  it('should handle multiple optional params from the real register_error pattern', () => {
    const source = `
      {% liquid
        assign key = key | default: null
        assign message = message | default: null
        assign errors = contract.errors
        assign field_errors = errors[field_name] | default: blank
        assign field_errors << message
        assign errors[field_name] = field_errors
        assign contract.valid = false
        return contract
      %}
    `;
    const result = extractUndefinedVariables(source);
    expect(result.required).to.deep.equal(['contract', 'field_name']);
    expect(result.optional).to.deep.equal(['key', 'message']);
  });
});
