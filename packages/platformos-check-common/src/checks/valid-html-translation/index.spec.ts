import { ValidHTMLTranslation } from './index';
import { highlightedOffenses, runYAMLCheck } from '../../test';
import { expect, describe, it } from 'vitest';

describe('Module: ValidHTMLTranslation', () => {
  it('should not report valid HTML in translations', async () => {
    const sourceCode = [
      'en:',
      '  hello_html: "<h1>Hello, world</h1>"',
      '  image_html: "<img src=\'spongebob.png\'>"',
      '  line_break_html: "<br>"',
      '  self_closing_svg_html: "<svg />"',
      '  foo: bar',
    ].join('\n');

    const offenses = await runYAMLCheck(
      ValidHTMLTranslation,
      sourceCode,
      'app/translations/en.yml',
    );
    expect(offenses).toHaveLength(0);
  });

  it('should report invalid HTML in translations', async () => {
    const sourceCode = 'en:\n  hello_html: "<h1>Hello, world"';

    const offenses = await runYAMLCheck(
      ValidHTMLTranslation,
      sourceCode,
      'app/translations/en.yml',
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).to.equal(
      "LiquidHTMLParsingError: Attempting to end parsing before HtmlElement 'h1' was closed.",
    );

    const highlights = highlightedOffenses({ 'app/translations/en.yml': sourceCode }, offenses);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).to.equal(`"<h1>Hello, world"`);
  });

  it('should report nested invalid HTML in translations', async () => {
    const sourceCode = [
      'en:',
      '  hello:',
      '    world:',
      '      today:',
      '        good:',
      '          day_html: "<h1>Hello, world"',
    ].join('\n');

    const offenses = await runYAMLCheck(
      ValidHTMLTranslation,
      sourceCode,
      'app/translations/en.yml',
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).to.equal(
      "LiquidHTMLParsingError: Attempting to end parsing before HtmlElement 'h1' was closed.",
    );

    const highlights = highlightedOffenses({ 'app/translations/en.yml': sourceCode }, offenses);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).to.equal(`"<h1>Hello, world"`);
  });

  it('should report pluralized key with invalid HTML', async () => {
    const sourceCode = 'en:\n  hello_html:\n    one: "<h1>Hello, world"';

    const offenses = await runYAMLCheck(
      ValidHTMLTranslation,
      sourceCode,
      'app/translations/en.yml',
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).to.equal(
      "LiquidHTMLParsingError: Attempting to end parsing before HtmlElement 'h1' was closed.",
    );

    const highlights = highlightedOffenses({ 'app/translations/en.yml': sourceCode }, offenses);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).to.equal(`"<h1>Hello, world"`);
  });
});
