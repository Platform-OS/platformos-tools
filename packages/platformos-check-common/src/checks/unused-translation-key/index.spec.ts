import { describe, it, expect, beforeEach } from 'vitest';
import { check } from '../../test';
import { UnusedTranslationKey, _resetForTesting } from '.';

describe('Module: UnusedTranslationKey', () => {
  beforeEach(() => {
    _resetForTesting();
  });
  it('should not report a key that is used in a template', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should report a key that is defined but never used', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello\n    unused: Bye',
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Translation key 'general.unused' is defined but never used in any template.",
    );
  });

  it('should not report keys used with dynamic variable', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/pages/home.liquid': `{{ some_key | t }}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1); // general.title is still unused
  });

  it('should accumulate used keys across multiple liquid files', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  a: A\n  b: B',
        'app/views/pages/page1.liquid': `{{"a" | t}}`,
        'app/views/pages/page2.liquid': `{{"b" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should report each unused key only once even with multiple liquid files', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  used: Used\n  unused: Unused',
        'app/views/pages/page1.liquid': '{{"used" | t}}',
        'app/views/pages/page2.liquid': '<h1>No translations</h1>',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Translation key 'unused' is defined but never used in any template.",
    );
  });

  it('should not report when no translation files exist', async () => {
    const offenses = await check(
      {
        'app/views/pages/home.liquid': `{{"general.title" | t}}`,
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should report an unused module public translation key', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/pages/home.liquid': '<h1>No translations used</h1>',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Translation key 'modules/user/greeting' is defined but never used in any template.",
    );
  });

  it('should not report a module translation key used in an app template', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/pages/home.liquid': '{{"modules/user/greeting" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report a module private translation key when used', async () => {
    const offenses = await check(
      {
        'app/modules/admin/private/translations/en.yml': 'en:\n  secret: TopSecret',
        'app/modules/admin/private/views/partials/panel.liquid': '{{"modules/admin/secret" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should handle mixed app and module translations', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  app_used: Yes\n  app_unused: No',
        'app/modules/user/public/translations/en.yml': 'en:\n  mod_used: Yes\n  mod_unused: No',
        'app/views/pages/home.liquid': '{{"app_used" | t}} {{"modules/user/mod_used" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(2);
    const messages = offenses.map((o) => o.message).sort();
    expect(messages).to.deep.equal([
      "Translation key 'app_unused' is defined but never used in any template.",
      "Translation key 'modules/user/mod_unused' is defined but never used in any template.",
    ]);
  });

  it('should discover translations in legacy modules/ path', async () => {
    const offenses = await check(
      {
        'modules/core/public/translations/en.yml': 'en:\n  legacy_key: Value',
        'app/views/pages/home.liquid': '{{"modules/core/legacy_key" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should scan Liquid files inside module directories for usage', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'modules/user/public/views/partials/header.liquid': '{{"modules/user/greeting" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should discover split-file translations', async () => {
    const offenses = await check(
      {
        'app/translations/en/buttons.yml': 'en:\n  save: Save\n  cancel: Cancel',
        'app/views/pages/form.liquid': '{{"save" | t}}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Translation key 'cancel' is defined but never used in any template.",
    );
  });

  it('should not report a key used as a default filter value', async () => {
    const offenses = await check(
      {
        'app/modules/core/public/translations/en.yml':
          'en:\n  validation:\n    blank: cannot be blank',
        'app/modules/core/public/views/partials/presence.liquid':
          '{% assign key = key | default: "modules/core/validation.blank" %}',
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report a key used as a default filter value with single quotes', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/pages/home.liquid': "{% assign msg = msg | default: 'greeting' %}",
      },
      [UnusedTranslationKey],
    );
    expect(offenses).to.have.length(0);
  });
});
