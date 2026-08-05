import { expect, describe, it } from 'vitest';
import { RequiredDocParamWithDefault } from './index';
import { MissingDocParam } from '../missing-doc-param';
import { MissingRenderPartialArguments } from '../missing-render-partial-arguments';
import { applyFix, check, highlightedOffenses, runLiquidCheck } from '../../test';
import { Severity } from '../../types';

const partialPath = 'app/views/partials/file.liquid';

describe('Module: RequiredDocParamWithDefault', () => {
  it('reports a required parameter the file reads through | default, once, naming it', async () => {
    const sourceCode = `{% doc %}
  @param {boolean} image_editor_enabled - whether to enable the image editor
  @param {string} aspect_ratio - aspect ratio for cropping
{% enddoc %}
{% liquid
  assign image_editor_enabled = image_editor_enabled | default: false
  assign aspect_ratio = aspect_ratio | default: null
%}`;

    const offenses = await runLiquidCheck(RequiredDocParamWithDefault, sourceCode);

    expect(offenses.map((offense) => offense.message)).toEqual([
      "The parameter 'image_editor_enabled' is declared as required, but this file supplies a default for it. Declare it optional as '[image_editor_enabled]'.",
      "The parameter 'aspect_ratio' is declared as required, but this file supplies a default for it. Declare it optional as '[aspect_ratio]'.",
    ]);
    expect(offenses.map((offense) => offense.severity)).toEqual([
      Severity.WARNING,
      Severity.WARNING,
    ]);
    expect(highlightedOffenses({ [partialPath]: sourceCode }, offenses)).toEqual([
      '@param {boolean} image_editor_enabled - whether to enable the image editor',
      '@param {string} aspect_ratio - aspect ratio for cropping',
    ]);
  });

  it('reports nothing for a parameter the doc already declares optional', async () => {
    const sourceCode = `{% doc %}
  @param {string} [aspect_ratio] - aspect ratio for cropping
{% enddoc %}
{% assign aspect_ratio = aspect_ratio | default: null %}`;

    const offenses = await runLiquidCheck(RequiredDocParamWithDefault, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing for a required parameter the file reads bare', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{{ title }}`;

    const offenses = await runLiquidCheck(RequiredDocParamWithDefault, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing for a required parameter that is only a | default FALLBACK source', async () => {
    // `params` is read when `profile` is missing, which says nothing about whether `params`
    // itself may be omitted. Only the value the file defaults is evidence of that.
    const sourceCode = `{% doc %}
  @param {object} params - the caller's argument hash
  @param {object} [profile] - the profile
{% enddoc %}
{% assign profile = profile | default: params.profile %}{{ profile }}`;

    const offenses = await runLiquidCheck(RequiredDocParamWithDefault, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('reports nothing on a partial with no doc block, nor on a file that is not a partial', async () => {
    const undocumented = `{% assign title = title | default: 'none' %}{{ title }}`;
    const documented = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{% assign title = title | default: 'none' %}{{ title }}`;

    expect(await runLiquidCheck(RequiredDocParamWithDefault, undocumented)).toEqual([]);
    expect(
      await runLiquidCheck(RequiredDocParamWithDefault, documented, 'app/views/pages/index.liquid'),
    ).toEqual([]);
  });

  it('brackets the parameter name in place, leaving its type and description untouched', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
  @param {string} aspect_ratio - aspect ratio for cropping
{% enddoc %}
{{ title }}{% assign aspect_ratio = aspect_ratio | default: null %}`;

    const offenses = await runLiquidCheck(RequiredDocParamWithDefault, sourceCode);

    expect(applyFix(sourceCode, offenses[0])).toEqual(`{% doc %}
  @param {string} title - the title
  @param {string} [aspect_ratio] - aspect ratio for cropping
{% enddoc %}
{{ title }}{% assign aspect_ratio = aspect_ratio | default: null %}`);
  });

  it('leaves the partial and its call sites clean once the fix is applied', async () => {
    const before = {
      [partialPath]: `{% doc %}
  @param {string} aspect_ratio - aspect ratio for cropping
{% enddoc %}
{% assign aspect_ratio = aspect_ratio | default: null %}{{ aspect_ratio }}`,
      'app/views/pages/index.liquid': `{% render 'file' %}`,
    };
    const checks = [RequiredDocParamWithDefault, MissingRenderPartialArguments];

    const offenses = await check(before, checks);
    expect(offenses.map((offense) => `${offense.check}: ${offense.message}`)).toEqual([
      "RequiredDocParamWithDefault: The parameter 'aspect_ratio' is declared as required, but this file supplies a default for it. Declare it optional as '[aspect_ratio]'.",
      "MissingRenderPartialArguments: Missing required argument 'aspect_ratio' in render tag for partial 'file'.",
    ]);

    const after = {
      ...before,
      [partialPath]: applyFix(before, offenses[0])!,
    };
    expect(await check(after, checks)).toEqual([]);
  });

  it('splits a partial with one undeclared and one defaulted parameter between the two checks', async () => {
    const sourceCode = `{% doc %}
  @param {string} title - the title
{% enddoc %}
{% assign title = title | default: 'none' %}{{ title }}{{ legacy }}`;

    const offenses = await check({ [partialPath]: sourceCode }, [
      RequiredDocParamWithDefault,
      MissingDocParam,
    ]);

    expect(offenses.map((offense) => `${offense.check}: ${offense.message}`)).toEqual([
      "RequiredDocParamWithDefault: The parameter 'title' is declared as required, but this file supplies a default for it. Declare it optional as '[title]'.",
      "MissingDocParam: The parameter 'legacy' is used but not declared in the doc tag of this file.",
    ]);
  });
});
