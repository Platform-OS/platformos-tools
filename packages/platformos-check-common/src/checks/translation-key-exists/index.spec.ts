import { TranslationKeyExists } from '.';
import { check } from '../../test';
import { expect, describe, it } from 'vitest';

describe('Module: TranslationKeyExists', () => {
  it('should report all keys if default locale file does not exist', async () => {
    const offenses = await check(
      {
        'code.liquid': `{{"key" | t}}
{{"nested.key" | t}}`,
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(2);
  });

  it('should handle key conflicts', async () => {
    const offenses = await check(
      {
        'locales/en.default.json': JSON.stringify({
          product: { quantity: 'TODO' },
        }),
        'code.liquid': '{{"product.quantity.decrease" | t}}',
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
  });

  it('should report offense when specific locale file does not exist', async () => {
    const offenses = await check(
      {
        'app/translations/en/general.yml': 'en:\n  general:\n    hello: Hello',
        'code.liquid': '{{"missing.key" | t}}',
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('missing.key');
    expect(offenses[0].message).to.include('does not have a matching translation entry');
  });

  it('should suggest nearest key when the key is a typo', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'code.liquid': `{{"general.titel" | t}}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0].suggest![0].message).to.include('general.title');
  });

  it('should not add suggestions when there is no close key', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'code.liquid': `{{"completely.different.xyz" | t}}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].suggest ?? []).to.have.length(0);
  });
});
