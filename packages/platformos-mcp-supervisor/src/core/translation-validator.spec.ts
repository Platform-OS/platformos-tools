import { describe, it, expect } from 'vitest';
import { validateTranslationYaml } from './translation-validator';

describe('validateTranslationYaml', () => {
  it('errors when the top-level is not a locale (e.g. `app:` at root)', () => {
    const content = ['app:', '  contact_form:', '    title: "Get in touch"'].join('\n');

    const { errors } = validateTranslationYaml(content, 'app/translations/en.yml');

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.check).toBe('pos-supervisor:TranslationMissingLocaleKey');
    expect(errors[0]!.severity).toBe('error');
    expect(errors[0]!.message).toMatch(/no top-level locale key/);
    expect(errors[0]!.message).toMatch(/`en:`/); // expected locale derived from filename
  });

  it('warns per stray non-locale top-level key when mixed with locales', () => {
    const content = [
      'en:',
      '  hello: "Hello"',
      'app:',
      '  title: "stray"',
      'foo:',
      '  bar: "stray"',
    ].join('\n');

    const { errors, warnings } = validateTranslationYaml(content, 'app/translations/en.yml');

    expect(errors).toEqual([]);
    const strays = warnings.filter((w) => w.check === 'pos-supervisor:TranslationStrayTopKey');
    expect(strays.length).toBe(2);
    expect(strays.map((s) => s.message).join('\n')).toMatch(/`app`/);
    expect(strays.map((s) => s.message).join('\n')).toMatch(/`foo`/);
  });

  it('accepts a properly locale-wrapped tree with no diagnostics', () => {
    const content = ['en:', '  hello: "Hello"', 'de:', '  hello: "Hallo"'].join('\n');

    const { errors, warnings } = validateTranslationYaml(content, 'app/translations/en.yml');

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports YAML parse errors as a structured diagnostic instead of throwing', () => {
    const broken = 'en:\n  key: "unterminated string\n';

    const { errors } = validateTranslationYaml(broken, 'app/translations/en.yml');

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.check).toBe('pos-supervisor:TranslationYAML');
    expect(errors[0]!.message).toMatch(/Invalid YAML syntax:/);
  });

  it('handles empty content as a no-op', () => {
    expect(validateTranslationYaml('', 'app/translations/en.yml')).toEqual({
      errors: [],
      warnings: [],
    });
    expect(validateTranslationYaml('   \n\n', 'app/translations/en.yml')).toEqual({
      errors: [],
      warnings: [],
    });
  });
});
