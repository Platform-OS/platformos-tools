import { describe, expect, it } from 'vitest';
import { check, highlightedOffenses, messagesOf, runLiquidCheck } from '../../test';
import { LiquidHTMLSyntaxError } from '../liquid-html-syntax-error';
import { UnsupportedStringEscape } from './index';

const FILE = 'app/views/partials/file.liquid';

describe('Module: UnsupportedStringEscape', () => {
  it('reports an escaped closing quote in an output, naming the value and what is left out', async () => {
    const sourceCode = `{{ "it's a \\"test\\"" | escape_javascript }}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(messagesOf(offenses)).toEqual([
      'String literals have no backslash escapes: `"it\'s a \\"` ends at the escaped `"`, ' +
        'so its value is `it\'s a \\` and `test\\""` is left outside the string. ' +
        'A string containing both quote kinds has to be built with {% capture %}.',
    ]);
    expect(highlightedOffenses({ [FILE]: sourceCode }, offenses)).toEqual([`"it's a \\"test\\""`]);
  });

  it('advises the other quote style when the text needs only one kind', async () => {
    const sourceCode = `{% assign x = "a \\"b\\"" %}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(messagesOf(offenses)).toEqual([
      'String literals have no backslash escapes: `"a \\"` ends at the escaped `"`, ' +
        'so its value is `a \\` and `b\\""` is left outside the string. ' +
        "Quote it with `'` instead: `'a \"b\"'`.",
    ]);
    expect(highlightedOffenses({ [FILE]: sourceCode }, offenses)).toEqual([`"a \\"b\\""`]);
  });

  it('reports it in a condition', async () => {
    const sourceCode = `{% if y == "a \\"b\\"" %}Y{% endif %}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(highlightedOffenses({ [FILE]: sourceCode }, offenses)).toEqual([`"a \\"b\\""`]);
  });

  it('reports it in a filter argument, which nothing reported before', async () => {
    const sourceCode = `{{ "abc" | replace: "b\\"c", "z" }}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(highlightedOffenses({ [FILE]: sourceCode }, offenses)).toEqual([`"b\\"c"`]);
  });

  it('reports a single-quoted literal', async () => {
    const sourceCode = `{{ 'it\\'s a "test"' | escape_javascript }}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(highlightedOffenses({ [FILE]: sourceCode }, offenses)).toEqual([`'it\\'s a "test"'`]);
  });

  it('offers no autofix: the quote swap is invalid inside a JSON literal', async () => {
    const sourceCode = `{% assign x = "a \\"b\\"" %}`;

    const offenses = await runLiquidCheck(UnsupportedStringEscape, sourceCode);

    expect(offenses.map((offense) => offense.fix)).toEqual([undefined]);
    expect(offenses.map((offense) => offense.suggest)).toEqual([undefined]);
  });

  describe('silence', () => {
    /**
     * The one legitimate use of `\"`. A JSON literal is parsed as JSON, where the escape is
     * real: measured on a live instance, `{% assign o = { "k": "a \"b\"" } %}` holds
     * `a "b"`, while the same text as a Liquid literal holds `a \`. The control below is that
     * same text one context over, so neither half of this pair can pass vacuously.
     */
    it('stays silent inside a JSON literal, where the escape is real', async () => {
      const jsonHash = `{% assign o = { "k": "a \\"b\\"" } %}`;
      const jsonArray = `{% assign a = [ "a \\"b\\"" ] %}`;

      expect(await runLiquidCheck(UnsupportedStringEscape, jsonHash)).toEqual([]);
      expect(await runLiquidCheck(UnsupportedStringEscape, jsonArray)).toEqual([]);

      // control: the same escape outside a JSON literal IS reported
      const liquidString = `{% assign o = "a \\"b\\"" %}`;
      expect(
        highlightedOffenses(
          { [FILE]: liquidString },
          await runLiquidCheck(UnsupportedStringEscape, liquidString),
        ),
      ).toEqual([`"a \\"b\\""`]);
    });

    it('stays silent inside a raw tag, which ships its contents verbatim', async () => {
      const raw = `{% raw %}{{ "a \\"b\\"" }}{% endraw %}`;

      expect(await runLiquidCheck(UnsupportedStringEscape, raw)).toEqual([]);

      // control: the same output outside the raw tag IS reported
      const outsideRaw = `{{ "a \\"b\\"" }}`;
      expect(
        highlightedOffenses(
          { [FILE]: outsideRaw },
          await runLiquidCheck(UnsupportedStringEscape, outsideRaw),
        ),
      ).toEqual([`"a \\"b\\""`]);
    });

    it('stays silent on a literal backslash before a quote that legitimately closes', async () => {
      expect(
        await runLiquidCheck(UnsupportedStringEscape, `{{ "ends with a backslash \\\\" }}`),
      ).toEqual([]);
      expect(await runLiquidCheck(UnsupportedStringEscape, `{{ "a\\nb" }}`)).toEqual([]);
      expect(await runLiquidCheck(UnsupportedStringEscape, `{{ x | append: "a" }}`)).toEqual([]);
    });
  });

  /**
   * One mistake, one diagnostic. `LiquidHTMLSyntaxError` used to answer these shapes with
   * `Syntax is not supported` pointed at the text the truncated literal spat out -- and with
   * an autofix that DELETED that text, which would have made the truncation permanent.
   */
  describe('with LiquidHTMLSyntaxError', () => {
    it('is the only offense on an output, an assign, and a condition', async () => {
      for (const sourceCode of [
        `{{ "it's a \\"test\\"" | escape_javascript }}`,
        `{% assign x = "a \\"b\\"" %}`,
        `{% if y == "a \\"b\\"" %}Y{% endif %}`,
      ]) {
        const offenses = await check({ [FILE]: sourceCode }, [
          LiquidHTMLSyntaxError,
          UnsupportedStringEscape,
        ]);

        expect(offenses.map((offense) => offense.check)).toEqual(['UnsupportedStringEscape']);
      }
    });

    it('defers on an ambiguous shape rather than guessing, and the generic reading still fires', async () => {
      // `"a \" b \\" c` could be a truncated literal or two values; a space after the closing
      // quote is how the expression legally continues, so this check stands down. The
      // pre-existing diagnostic must survive that deferral -- silence in both is a hole.
      const sourceCode = `{% assign x = "a \\" b \\\\" c %}`;

      expect(await runLiquidCheck(UnsupportedStringEscape, sourceCode)).toEqual([]);
      expect(
        (await check({ [FILE]: sourceCode }, [LiquidHTMLSyntaxError])).map(
          (offense) => offense.check,
        ),
      ).toEqual(['LiquidHTMLSyntaxError']);
    });

    it('does not silence the generic reading of markup that has no escaped quote', async () => {
      // The fixtures each detector's own spec is pinned by, so a suppression wide enough to
      // hide one of them fails here rather than in a release.
      for (const sourceCode of [
        `{{ "a" b }}`,
        `{% echo one two %}`,
        `{% assign x = "a" b %}`,
        `{% if y == "a" b %}Y{% endif %}`,
      ]) {
        const offenses = await check({ [FILE]: sourceCode }, [
          LiquidHTMLSyntaxError,
          UnsupportedStringEscape,
        ]);

        expect(offenses.map((offense) => offense.check)).toEqual(['LiquidHTMLSyntaxError']);
      }
    });
  });
});
