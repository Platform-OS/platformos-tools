import { expect, describe, it } from 'vitest';
import { check } from '../../test';
import { MatchingTranslations } from '../../checks/matching-translations/index';

describe('Module: MatchingTranslations', async () => {
  it('should report offenses when the translation file is missing a key', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n  world: World\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense("The translation for 'world' is missing");
  });

  it('should report offenses when the default translation is missing a key', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  world: Mundo\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense("A default translation for 'world' does not exist");
  });

  it('should report offenses when nested translation keys do not exist', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: {}\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(1);
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/pt-BR.yml`,
    });
  });

  it('should report offenses when translation shapes do not match', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(2);
    expect(offenses).to.containOffense({
      message: "A default translation for 'hello' does not exist",
      uri: `file:///app/translations/pt-BR.yml`,
    });
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/pt-BR.yml`,
    });
  });

  it('should report offenses when nested translation keys do not match', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/fr.yml': 'fr:\n  hello:\n    monde: Bonjour, monde\n',
      'app/translations/es-ES.yml':
        'es-ES:\n  hello:\n    world: Hello, world!\n    mundo:\n      hola: "¡Hola, mundo!"\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(3);
    expect(offenses).to.containOffense({
      message: "A default translation for 'hello.monde' does not exist",
      uri: `file:///app/translations/fr.yml`,
    });
    expect(offenses).to.containOffense({
      message: "A default translation for 'hello.mundo.hola' does not exist",
      uri: `file:///app/translations/es-ES.yml`,
    });
    expect(offenses).to.containOffense({
      message: "The translation for 'hello.world' is missing",
      uri: `file:///app/translations/fr.yml`,
    });
  });

  it('should not report offenses when default translations do not exist (no en.yml)', async () => {
    const theme = {
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses when translations match', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello: Hello\n  world: World\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: Olá\n  world: Mundo\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses when nested translations match', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello:\n    world: Olá, mundo!\n',
      'app/translations/fr.yml': 'fr:\n  hello:\n    world: Bonjour, monde\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not report offenses and ignore pluralization', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    one: Hello, you\n    other: "Hello, y\'all"\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello:\n    zero: Estou sozinho :(\n    few: "Olá, galerinha :)"\n',
    };

    const offenses = await check(theme, [MatchingTranslations]);

    expect(offenses).to.be.of.length(0);
  });

  it('should not highlight anything if the file is unparseable', async () => {
    const theme = {
      'app/translations/en.yml': 'en:\n  hello:\n    world: Hello, world!\n',
      'app/translations/pt-BR.yml': 'pt-BR:\n  hello: :\n  bad yaml',
    };

    const offenses = await check(theme, [MatchingTranslations]);
    expect(offenses).to.have.length(0);
  });
});
