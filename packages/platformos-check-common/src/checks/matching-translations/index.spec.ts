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
