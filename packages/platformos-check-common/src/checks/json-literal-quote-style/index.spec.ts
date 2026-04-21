import { expect, describe, it } from 'vitest';
import { JsonLiteralQuoteStyle } from './index';
import { applyFix, runLiquidCheck } from '../../test';

describe('Module: JsonLiteralQuoteStyle', () => {
  it('should report single-quoted keys in an inline hash literal', async () => {
    const sourceCode = `{% assign a = {'a': 5} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      'Use double quotes for string literals inside object/array literals (e.g. \'{"key": "value"}\', not "{\'key\': \'value\'}").',
    );
  });

  it('should report single-quoted string values in an inline hash literal', async () => {
    const sourceCode = `{% assign a = {"key": 'value'} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(1);
  });

  it('should report both single-quoted keys and values', async () => {
    const sourceCode = `{% assign a = {'a': 'b', 'c': 'd'} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(4);
  });

  it('should report single-quoted strings in nested hash literals', async () => {
    const sourceCode = `{% assign a = {"outer": {'inner': 1}} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(1);
  });

  it('should report single-quoted strings inside array literals', async () => {
    const sourceCode = `{% assign a = ['x', 'y'] %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(2);
  });

  it('should not report double-quoted strings in object literals', async () => {
    const sourceCode = `{% assign a = {"a": "b", "c": [1, "d"]} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.be.empty;
  });

  it('should not report bare keys in object literals', async () => {
    const sourceCode = `{% assign a = {a: 2} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.be.empty;
  });

  it('should not report single-quoted strings outside of inline JSON literals', async () => {
    const sourceCode = `
      {% assign a = 'plain string' %}
      {% assign b = 'pass' | upcase %}
      {{ 'hello' }}
    `;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.be.empty;
  });

  it('should not report parse_json style JSON-in-a-string', async () => {
    const sourceCode = `{% assign a = '{"a": 5}' | parse_json %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.be.empty;
  });

  it('should fix single-quoted keys to double-quoted keys', async () => {
    const sourceCode = `{% assign a = {'a': 5} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);
    const fixed = applyFix(sourceCode, offenses[0]);

    expect(fixed).to.equal(`{% assign a = {"a": 5} %}`);
  });

  it('should fix single-quoted string values to double-quoted values', async () => {
    const sourceCode = `{% assign a = {"key": 'value'} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);
    const fixed = applyFix(sourceCode, offenses[0]);

    expect(fixed).to.equal(`{% assign a = {"key": "value"} %}`);
  });

  it('should properly escape embedded double quotes when fixing', async () => {
    const sourceCode = `{% assign a = {'msg': 'she said "hi"'} %}`;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);
    expect(offenses).to.have.length(2);

    const valueOffense = offenses.find((o) =>
      sourceCode.slice(o.start.index, o.end.index).includes('she said'),
    );
    expect(valueOffense).to.not.be.undefined;

    const fixedValue = applyFix(sourceCode, valueOffense!);
    expect(fixedValue).to.equal(`{% assign a = {'msg': "she said \\"hi\\""} %}`);
  });

  it('should report single-quoted strings in function return literals', async () => {
    const sourceCode = `
      {% function result = my_func %}
        {% return {'a': 5} %}
      {% endfunction %}
    `;

    const offenses = await runLiquidCheck(JsonLiteralQuoteStyle, sourceCode);

    expect(offenses).to.have.length(1);
  });
});
