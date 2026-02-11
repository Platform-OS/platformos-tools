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
});
