import { TranslationKeyExists } from '.';
import { check } from '../../test';
import { expect, describe, it } from 'vitest';

describe('Module: TranslationKeyExists', () => {
  it('should report all keys if default locale file does not exist', async () => {
    const offenses = await check(
      {
        'app/views/partials/code.liquid': `{{"key" | t}}
{{"nested.key" | t}}`,
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(2);
  });

  it('should find a key whose value is a LIST', async () => {
    // `{{ 'app.relationships.type' | t | parse_json }}` is a real pattern: the key holds
    // a list and the caller parses it. Descending INTO the list turned the key into
    // `…type.0`, `…type.1`, so the key the author actually writes looked undefined.
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  types:\n    - followship\n    - membership\n',
        'app/views/partials/code.liquid': `{{ 'types' | t | parse_json }}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
  });

  it('should find a key defined in a file that has a duplicated mapping key', async () => {
    // Strict js-yaml rejects such a file outright, which made every key in it look
    // undefined. The platform renders it, last value winning, and so does the reader
    // now; `YAMLSyntaxError` reports the duplicate itself.
    const offenses = await check(
      {
        'app/translations/en/admin.yml':
          'en:\n  admin:\n    title: Admin\n    title: Admin panel\n    check_all: Check all\n',
        'app/views/partials/code.liquid': '{{"admin.check_all" | t}}{{"admin.title" | t}}',
      },
      [TranslationKeyExists],
    );

    expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
  });

  it('should find keys defined under the legacy marketplace_builder root', async () => {
    // `getSearchPaths` covers every app root; hardcoding `app/translations` made a
    // legacy-rooted project's every `| t` call look undefined.
    const offenses = await check(
      {
        'marketplace_builder/translations/en.yml': 'en:\n  greeting: Hello\n',
        'marketplace_builder/views/partials/code.liquid': `{{ 'greeting' | t }}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
  });

  it('should handle key conflicts', async () => {
    // The conflict: `item.quantity` is a leaf, so `item.quantity.decrease`
    // cannot resolve.
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  item:\n    quantity: TODO\n',
        'app/views/partials/code.liquid': '{{"item.quantity.decrease" | t}}',
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
  });

  it('should report offense when specific locale file does not exist', async () => {
    const offenses = await check(
      {
        'app/translations/en/general.yml': 'en:\n  general:\n    hello: Hello',
        'app/views/partials/code.liquid': '{{"missing.key" | t}}',
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "'missing.key' does not have a matching translation entry",
    );
  });

  it('should suggest nearest key when the key is a typo', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/partials/code.liquid': `{{"general.titel" | t}}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0].suggest![0].message).to.equal("Did you mean 'general.title'?");
  });

  it('should not add suggestions when there is no close key', async () => {
    const offenses = await check(
      {
        'app/translations/en.yml': 'en:\n  general:\n    title: Hello',
        'app/views/partials/code.liquid': `{{"completely.different.xyz" | t}}`,
      },
      [TranslationKeyExists],
    );

    expect(offenses).to.have.length(1);
    expect(offenses[0].suggest ?? []).to.have.length(0);
  });

  it('should not report a module translation key that exists', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/partials/code.liquid': '{{"modules/user/greeting" | t}}',
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(0);
  });

  it('should report a module translation key that does not exist', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/partials/code.liquid': '{{"modules/user/missing" | t}}',
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "'modules/user/missing' does not have a matching translation entry",
    );
  });

  it('should suggest nearest module key for typos', async () => {
    const offenses = await check(
      {
        'app/modules/user/public/translations/en.yml': 'en:\n  greeting: Hello',
        'app/views/partials/code.liquid': '{{"modules/user/greating" | t}}',
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0].suggest![0].message).to.equal("Did you mean 'modules/user/greeting'?");
  });

  it('should find keys in legacy modules/ path', async () => {
    const offenses = await check(
      {
        'modules/core/public/translations/en.yml': 'en:\n  label: Label',
        'app/views/partials/code.liquid': '{{"modules/core/label" | t}}',
      },
      [TranslationKeyExists],
    );
    expect(offenses).to.have.length(0);
  });
});
