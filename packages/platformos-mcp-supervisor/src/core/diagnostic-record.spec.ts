/**
 * diagnostic-record unit tests — pin the per-check `extractParams` registry
 * and the `templateOf` wrapper.
 *
 * v1 trim (P12): source exported `messageTemplate`, `fingerprint`,
 * `templateFingerprint`, `makeDiagnosticRecord`, `DIAGNOSTIC_RECORD_VERSION`,
 * and `KNOWN_EXTRACTOR_CHECKS` for the analytics layer. Those are dropped.
 * Only `templateOf` and `extractParams` survive (the helpers consumed by
 * `error-enricher` + `fix-generator`). The corresponding test cases from
 * source (`fingerprint hashing`, `makeDiagnosticRecord`,
 * `messageTemplate masking`, the `KNOWN_EXTRACTOR_CHECKS` registry view)
 * are dropped here too. The masking algorithm is still indirectly covered
 * via `templateOf` since it wraps the same internal helper.
 */

import { describe, it, expect } from 'vitest';
import { templateOf, extractParams } from './diagnostic-record';

describe('diagnostic-record: templateOf (identifier masking)', () => {
  it('masks single-quoted identifiers', () => {
    expect(templateOf('UnknownFilter', "Variable 'foo' is undefined")).toBe(
      'Variable <id> is undefined',
    );
  });

  it('masks double-quoted identifiers', () => {
    expect(templateOf('MissingPartial', 'Cannot find "products/index"')).toBe(
      'Cannot find <id>',
    );
  });

  it('masks backticked identifiers', () => {
    expect(templateOf('DeprecatedTag', 'Use `render` instead of `include`')).toBe(
      'Use <id> instead of <id>',
    );
  });

  it('masks bare integers and floats', () => {
    expect(templateOf('UnknownProperty', 'Line 42 column 7.5 broken')).toBe(
      'Line <n> column <n> broken',
    );
  });

  it('masks hex literals', () => {
    expect(templateOf('UnknownProperty', 'Color #fff value 0xff is invalid')).toBe(
      'Color #fff value <n> is invalid',
    );
  });

  it('does not chew embedded numerics inside identifiers', () => {
    // "html5" stays intact (not "html<n>") because the regex is word-anchored.
    expect(templateOf('UnknownProperty', 'html5 doctype required')).toBe('html5 doctype required');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(templateOf('UnknownFilter', '   foo   bar  ')).toBe('foo bar');
  });

  it('returns empty string for non-string input', () => {
    expect(templateOf('UnknownFilter', null as unknown as string)).toBe('');
    expect(templateOf('UnknownFilter', undefined as unknown as string)).toBe('');
  });
});

describe('diagnostic-record: extractParams per check', () => {
  it('UnknownFilter: pulls filter name', () => {
    expect(extractParams('UnknownFilter', "Unknown filter 'json'")).toEqual({ filter: 'json' });
  });

  it('UnknownFilter: empty when no quoted name', () => {
    expect(extractParams('UnknownFilter', 'Unknown filter')).toEqual({});
  });

  it('UndefinedObject: pulls variable name (first quoted)', () => {
    expect(extractParams('UndefinedObject', "Variable 'product' is undefined")).toEqual({
      variable: 'product',
    });
  });

  it('UnusedAssign: pulls variable name', () => {
    expect(extractParams('UnusedAssign', "The variable 'x' is assigned but not used")).toEqual({
      variable: 'x',
    });
  });

  it('MissingPartial: pulls partial name', () => {
    expect(extractParams('MissingPartial', "'forms/login' does not exist")).toEqual({
      partial: 'forms/login',
    });
  });

  it('TranslationKeyExists: pulls key + flags typo suggestion', () => {
    expect(
      extractParams(
        'TranslationKeyExists',
        "Translation key 'a.b.c' not found. Did you mean 'a.b.cd'?",
      ),
    ).toEqual({ key: 'a.b.c', has_typo_suggestion: 'true' });
  });

  it('UnknownProperty: pulls property and object', () => {
    expect(extractParams('UnknownProperty', 'Unknown property `name` on `current_user`')).toEqual({
      property: 'name',
      object: 'current_user',
    });
  });

  it('DeprecatedTag: pulls tag and replacement', () => {
    expect(extractParams('DeprecatedTag', "Tag 'include' is deprecated, use 'render'")).toEqual({
      tag: 'include',
      replacement: 'render',
    });
  });

  it('DeprecatedTag: include defaults replacement to render', () => {
    expect(extractParams('DeprecatedTag', "'include' is deprecated")).toEqual({
      tag: 'include',
      replacement: 'render',
    });
  });

  it('MissingRenderPartialArguments: pulls partial + missing param', () => {
    expect(
      extractParams(
        'MissingRenderPartialArguments',
        "Missing required argument 'email' in render tag for partial 'sessions/form'",
      ),
    ).toEqual({ partial: 'sessions/form', missing_param: 'email' });
  });

  it('MetadataParamsCheck: classifies function vs render', () => {
    expect(extractParams('MetadataParamsCheck', 'Missing param in function call')).toEqual({
      is_function_call: 'true',
    });
    expect(extractParams('MetadataParamsCheck', 'Missing param in render tag')).toEqual({
      is_function_call: 'false',
    });
  });

  it('GraphQLCheck: unused variable', () => {
    expect(
      extractParams('GraphQLCheck', 'Variable "$id" is never used in operation "x"'),
    ).toEqual({ category: 'unused_variable', variable: 'id' });
  });

  it('GraphQLCheck: unknown field on Record', () => {
    expect(extractParams('GraphQLCheck', 'Cannot query field "name" on type "Record"')).toEqual({
      category: 'unknown_field_record',
      field: 'name',
      type: 'Record',
    });
  });

  it('GraphQLCheck: unknown field on other type', () => {
    expect(extractParams('GraphQLCheck', 'Cannot query field "foo" on type "Bar"')).toEqual({
      category: 'unknown_field_other',
      field: 'foo',
      type: 'Bar',
    });
  });

  it('GraphQLCheck: type mismatch (filter)', () => {
    expect(
      extractParams(
        'GraphQLCheck',
        'Variable "$id" of type "ID!" used in position expecting type "UniqIdFilter"',
      ),
    ).toEqual({
      category: 'type_mismatch_filter',
      variable: 'id',
      actual_type: 'ID!',
      expected_type: 'UniqIdFilter',
    });
  });

  it('GraphQLCheck: generic fallback for unrecognized format', () => {
    expect(extractParams('GraphQLCheck', 'Some unknown graphql error')).toEqual({
      category: 'generic',
    });
  });

  it('returns {} for an unknown check', () => {
    expect(extractParams('NotARealCheck', 'whatever')).toEqual({});
  });
});
