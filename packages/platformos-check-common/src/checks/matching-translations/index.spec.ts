import { expect, describe, it } from 'vitest';
import { check } from '../../test';
import { MatchingTranslations } from '../../checks/matching-translations/index';

describe('Module: MatchingTranslations', async () => {
  it('should report offenses when the translation file is missing a key', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n  world: World\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense("The translation for 'world' is missing");
  });

  it('should report offenses when the default translation is missing a key', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  world: Mundo\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense("A translation for 'world' does not exist in the en locale");
  });

  it('should report offenses when nested translation keys do not exist', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: {}\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/pt-BR.yml`,
    });
  });

  it('should report offenses when translation shapes do not match', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(2);
    expect(offenses).to.containOffense({
      message: "A translation for 'hello' does not exist in the en locale",
      uri: `file:///app/translations/pt-BR.yml`,
    });
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/pt-BR.yml`,
    });
  });

  it('should report offenses when nested translation keys do not match', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/fr.yml': 'fr:\n  hello:\n    monde: Bonjour, monde\n',
      'app/translations/es-ES.yml':
        'es-ES:\n  hello:\n    world: Hello, world!\n    mundo:\n      hola: "¡Hola, mundo!"\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(3);
    expect(offenses).to.containOffense({
      message: "A translation for 'hello.monde' does not exist in the en locale",
      uri: `file:///app/translations/fr.yml`,
    });
    expect(offenses).to.containOffense({
      message: "A translation for 'hello.mundo.hola' does not exist in the en locale",
      uri: `file:///app/translations/es-ES.yml`,
    });
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/fr.yml`,
    });
  });

  it('should not report offenses when default translations do not exist (no en.yml)', async () => {
    const app = {
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses when translations match', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n  world: World\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  world: Mundo\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses when nested translations match', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello:\n    world: Olá, mundo!\n',
      'app/translations/fr.yml': 'fr:\n  hello:\n    world: Bonjour, monde\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses and ignore pluralization', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    one: Hello, you\n    other: "Hello, y\'all"\n',
      'app/translations/pt-BR.yml':
        'pt-BR:\n  hello:\n    zero: Estou sozinho :(\n    few: "Olá, galerinha :)"\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not highlight anything if the file is unparseable', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: :\n  bad yaml',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(0);
  });

  // --- Multi-file / multi-scope tests ---

  it('should not flag keys from a different translation scope (module vs app)', async () => {
    // Module translations are auto-prefixed with their module name at runtime, so each
    // module is its own isolated scope. The app scope should never need keys from
    // modules/common-styling/public/translations/en.yml.
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
      'modules/common-styling/public/translations/en.yml':
        'en:\n  password:\n    toggle_visibility: Toggle\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(0);
  });

  it('should report missing keys in a module non-en file against that module own en translations', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'modules/common-styling/public/translations/en.yml':
        'en:\n  password:\n    toggle_visibility: Toggle\n',
      'modules/common-styling/public/translations/pt-BR.yml': 'pt-BR:\n  other: Outro\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense({
      message: "The translation for 'password.toggle_visibility' is missing",
      uri: 'file:///modules/common-styling/public/translations/pt-BR.yml',
    });
  });

  it('should skip files inside the en/ locale sub-directory (they are English source files)', async () => {
    // Files like app/translations/en/validation.yml are English — the check must not
    // lint them as if they were a "non-English" locale file to compare.
    const app = {
      'app/translations/en/validation.yml': 'en:\n  required: Required\n',
      'app/translations/pt-BR/validation.yml': 'pt-BR:\n  required: Obrigatório\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(0);
  });

  it('should aggregate multiple en/*.yml files within one scope as the reference set', async () => {
    // Within the app scope, en/auth.yml and en/checkout.yml both contribute to the
    // reference; pt-BR.yml must cover all of them.
    const app = {
      'app/translations/en/auth.yml': 'en:\n  login: Log in\n',
      'app/translations/en/checkout.yml': 'en:\n  submit: Submit\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  login: Entrar\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense({
      message: "The translation for 'submit' is missing",
      uri: 'file:///app/translations/pt-BR.yml',
    });
  });

  it('should aggregate en.yml and en/*.yml together as the scope reference set', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'app/translations/en/auth.yml': 'en:\n  login: Log in\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense({
      message: "The translation for 'login' is missing",
      uri: 'file:///app/translations/pt-BR.yml',
    });
  });

  /**
   * `moto:` with nothing after it is a key whose value is nil, and real projects have
   * them — a translator left the text out. `typeof null === 'object'`, so walking the
   * reference set recurses into it and throws, which costs EVERY file in that locale
   * scope its offenses. The key exists, it just has no text, so it counts on both sides.
   */
  describe('a key with no value', () => {
    it('should treat it as a key the locale must have, not as a nested object', async () => {
      const app = {
        'app/translations/en.yml': 'en:\n  hello: Hello\n  moto:\n',
        'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => offense.message)).to.deep.equal([
        "The translation for 'moto' is missing",
      ]);
    });

    it('should accept it as covering the en key it stands for', async () => {
      const app = {
        'app/translations/en.yml': 'en:\n  hello: Hello\n  moto: Ride\n',
        'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  moto:\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
    });

    it('should still report it when the en locale has no such key', async () => {
      const app = {
        'app/translations/en.yml': 'en:\n  hello: Hello\n',
        'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  moto:\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => offense.message)).to.deep.equal([
        "A translation for 'moto' does not exist in the en locale",
      ]);
    });

    it('should keep checking the rest of a scope whose reference set has one', async () => {
      // The throw was in the shared reference walk, so it took every file with it.
      const app = {
        'app/translations/en.yml': 'en:\n  moto:\n  hello: Hello\n  world: World\n',
        'app/translations/pt-BR.yml': 'pt-BR:\n  moto: Moto\n  hello: Olá\n',
        'app/translations/fr.yml': 'fr:\n  moto: Moto\n  hello: Bonjour\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => `${offense.uri} ${offense.message}`).sort()).to.deep.equal([
        "file:///app/translations/fr.yml The translation for 'world' is missing",
        "file:///app/translations/pt-BR.yml The translation for 'world' is missing",
      ]);
    });
  });

  /**
   * A duplicated mapping key is a real authoring bug (`YAMLSyntaxError` reports it), but
   * it is not a reason to read the file as empty. Doing so cost `MatchingTranslations`
   * 561 offenses that were not there on one real project: five of its 39 `en/*.yml`
   * files had a duplicate, so every key those files define looked absent from `en`.
   */
  it('should treat a list value as one key, not as one key per element', async () => {
    // `t` returns the whole list — `{{ 'types' | t | parse_json }}` is how a project reads
    // one — so `types.1` is not a key anyone can add, and a translated list is allowed to
    // be a different length. `TranslationKeyExists` counts the same key the same way.
    const app = {
      'app/translations/en.yml': 'en:\n  types:\n    - followship\n    - membership\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  types:\n    - seguir\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
  });

  it('should still report a locale missing a list-valued key entirely', async () => {
    const app = {
      'app/translations/en.yml': 'en:\n  types:\n    - followship\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(app, [MatchingTranslations]);

    expect(offenses.map((offense) => offense.message)).to.deep.equal([
      "A translation for 'hello' does not exist in the en locale",
      "The translation for 'types' is missing",
    ]);
  });

  describe('when an en file has a duplicated mapping key', () => {
    it('should still count the keys that file defines as present in en', async () => {
      const app = {
        'app/translations/en/admin.yml':
          'en:\n  admin:\n    title: Admin\n    title: Admin panel\n    check_all: Check all\n',
        'app/translations/pt-BR/admin.yml':
          'pt-BR:\n  admin:\n    title: Administração\n    check_all: Marcar todos\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => offense.message)).to.deep.equal([]);
    });

    it('should keep reporting a key the locale really does define alone', async () => {
      const app = {
        'app/translations/en/admin.yml':
          'en:\n  admin:\n    title: Admin\n    title: Admin panel\n',
        'app/translations/pt-BR/admin.yml':
          'pt-BR:\n  admin:\n    title: Administração\n    ghost: Fantasma\n',
      };

      const offenses = await check(app, [MatchingTranslations]);

      expect(offenses.map((offense) => offense.message)).to.deep.equal([
        "A translation for 'admin.ghost' does not exist in the en locale",
      ]);
    });
  });

  it('should not report a key as missing if it is covered by another file in the same locale scope', async () => {
    // pt-BR/validation.yml covers 'required' — pt-BR.yml should not be blamed for it
    const app = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'app/translations/en/validation.yml': 'en:\n  required: Required\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
      'app/translations/pt-BR/validation.yml': 'pt-BR:\n  required: Obrigatório\n',
    };

    const offenses = await check(app, [MatchingTranslations]);
    expect(offenses).to.have.length(0);
  });
});
