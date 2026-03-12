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
    expect(offenses[0].message).to.include('general.unused');
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
    expect(offenses[0].message).to.include('unused');
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
});
