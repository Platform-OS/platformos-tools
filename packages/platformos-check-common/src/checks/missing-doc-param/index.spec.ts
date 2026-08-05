import { expect, describe, it } from 'vitest';
import { MissingDocParam } from './index';
import { UndefinedObject } from '../undefined-object';
import { applySuggestions, check, highlightedOffenses, runLiquidCheck } from '../../test';
import { Severity } from '../../types';

const partialPath = 'app/views/partials/file.liquid';

describe('Module: MissingDocParam', () => {
  it('reports a variable read bare and absent from the doc, once, at its first read', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}{{ legacy }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'legacy' is used but not declared in the doc tag of this file.",
    ]);
    expect(offenses.map((offense) => offense.severity)).toEqual([Severity.ERROR]);
    expect(highlightedOffenses({ [partialPath]: sourceCode }, offenses)).toEqual(['legacy']);
  });

  it('reports a variable read many times only once', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ legacy }}{{ legacy.name }}{% if legacy %}{{ title }}{% endif %}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'legacy' is used but not declared in the doc tag of this file.",
    ]);
  });

  it('reports several undeclared variables in order of first read', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}{{ subtitle }}{{ author }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'subtitle' is used but not declared in the doc tag of this file.",
      "The parameter 'author' is used but not declared in the doc tag of this file.",
    ]);
  });

  it('reports nothing when the doc declares everything the partial uses', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
  @param {string} [subtitle] - the subtitle
{% enddoc %}
{{ title }}{{ subtitle }}
{% assign heading = title %}{{ heading }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing for globally accessible objects or for app', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ context.location.href }}{{ app.name }}{{ title }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing on a partial with no doc block', async () => {
    const sourceCode = `{{ legacy }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing on a doc block that declares no parameter', async () => {
    // A doc holding only prose declares no contract, so nothing can have drifted from it:
    // the call-site checks infer the parameter list from the source instead.
    const sourceCode = `{% doc %}
  @description renders a card
  @example
    {% render 'file' %}
{% enddoc %}
{{ legacy }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing on a file that is not a partial', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}{{ legacy }}`;

    const offenses = await runLiquidCheck(
      MissingDocParam,
      sourceCode,
      'app/views/pages/index.liquid',
    );

    expect(offenses).toEqual([]);
  });

  it('reports a name read only as a | default fallback source', async () => {
    // `params` is read exactly when `profile` is missing, but it is still an input the
    // caller has to supply and cannot: an undeclared name is not a passable argument.
    const sourceCode = `{% doc %}
  @param {object} [profile] - the profile
{% enddoc %}
{% assign profile = profile | default: params.profile %}{{ profile }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'params' is used but not declared in the doc tag of this file.",
    ]);
  });

  it('reports an undeclared name the partial defaults inline', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}{{ subtitle | default: 'none' }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'subtitle' is used but not declared in the doc tag of this file.",
    ]);
  });

  it('leaves a name the file defines but reads out of scope to UndefinedObject', async () => {
    // Neither name is an input: `item` is a loop variable read after its loop, and `basket` is
    // written by the file itself. No `@param` would fix either, so reporting them here would
    // say the doc is at fault and would double up on the check that owns scope errors.
    const sourceCode = `{% doc %}
  @param {array} rows - the rows
{% enddoc %}
{% for item in rows %}{{ item }}{% endfor %}{{ item }}
{% hash_assign basket['fruit'] = 'apple' %}`;

    const offenses = await check({ [partialPath]: sourceCode }, [MissingDocParam, UndefinedObject]);

    expect(offenses.map((offense) => `${offense.check}: ${offense.message}`)).toEqual([
      "UndefinedObject: Unknown object 'item' used.",
      "UndefinedObject: Unknown object 'basket' used.",
    ]);
  });

  it('suggests declaring the parameter after the last declared one, at its indentation', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
  @param {string} [subtitle] - the subtitle
  @example
    {% render 'file', title: 'x' %}
{% enddoc %}
{{ title }}{{ subtitle }}{{ legacy }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(offenses.map((offense) => offense.suggest?.map((s) => s.message))).toEqual([
      ["Declare 'legacy' in the doc tag"],
    ]);
    expect(applySuggestions(sourceCode, offenses[0])).toEqual([
      `{% doc %}
  @param {string} title - the title
  @param {string} [subtitle] - the subtitle
  @param legacy
  @example
    {% render 'file', title: 'x' %}
{% enddoc %}
{{ title }}{{ subtitle }}{{ legacy }}`,
    ]);
  });

  it('leaves the declaration it suggests free of a type it cannot know', async () => {
    // The variable is being READ, so nothing in the file says what a caller should pass.
    // `{% doc %}` makes the type optional, and a guessed one is a claim the type checks act on.
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}{{ legacy }}`;

    const offenses = await runLiquidCheck(MissingDocParam, sourceCode);

    expect(applySuggestions(sourceCode, offenses[0])).toEqual([
      `{% doc %}
  @param {string} title - the title
  @param legacy
{% enddoc %}
{{ title }}{{ legacy }}`,
    ]);
  });
});
