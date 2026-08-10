import { describe, it, expect } from 'vitest';
import { applySuggestions, runLiquidCheck } from '../../test';
import { MissingRenderPartialArguments } from '.';
import { Severity } from '../../types';

function check(partial: string, source: string) {
  return runLiquidCheck(
    MissingRenderPartialArguments,
    source,
    undefined,
    {},
    { 'app/views/partials/card.liquid': partial },
  );
}

const partialWithRequiredParams = `
{% doc %}
  @param {string} title - The card title
  @param {string} [subtitle] - Optional subtitle
{% enddoc %}
`;

describe('Module: MissingRenderPartialArguments', () => {
  it('should not report when partial has no LiquidDoc', async () => {
    const offenses = await check('<h1>card</h1>', `{% render 'card' %}`);
    expect(offenses).to.have.length(0);
  });

  it('should not report an absent OPTIONAL param when every required one is provided', async () => {
    // `[subtitle]` is the optional one, and it is absent. The control is the same partial
    // with that same param declared REQUIRED: without it, "optional params are not
    // reported" passes just as well against a check that reports nothing at all. The two
    // assertions used to be two tests running the identical call.
    const call = `{% render 'card', title: 'Hello' %}`;
    const optional = await check(partialWithRequiredParams, call);
    const sameParamRequired = await check(
      partialWithRequiredParams.replace('[subtitle]', 'subtitle'),
      call,
    );

    expect({
      optional: optional.map((offense) => offense.message),
      sameParamRequired: sameParamRequired.map((offense) => offense.message),
    }).toEqual({
      optional: [],
      sameParamRequired: ["Missing required argument 'subtitle' in render tag for partial 'card'."],
    });
  });

  it('should report ERROR when a required param is missing', async () => {
    const offenses = await check(partialWithRequiredParams, `{% render 'card' %}`);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Missing required argument 'title' in render tag for partial 'card'.",
    );
  });

  it('should suggest adding the missing required param', async () => {
    const source = `{% render 'card' %}`;
    const offenses = await check(partialWithRequiredParams, source);
    expect(offenses[0].suggest).to.have.length(1);
    expect(offenses[0].suggest![0].message).to.equal("Add required argument 'title'");
    const fixed = applySuggestions(source, offenses[0]);
    expect(fixed).to.not.be.undefined;
    expect(fixed![0]).to.equal("{% render 'card', title: '' %}");
  });

  it('should report one ERROR per missing required param', async () => {
    const partial = `
      {% doc %}
        @param {string} title - title
        @param {string} body - body
      {% enddoc %}
    `;
    const offenses = await check(partial, `{% render 'card' %}`);
    expect(offenses).to.have.length(2);
  });

  it('should not report for dynamic partials', async () => {
    const offenses = await runLiquidCheck(
      MissingRenderPartialArguments,
      `{% render partial_name %}`,
    );
    expect(offenses).to.have.length(0);
  });

  // ─── an include site is bound by the contract too ─────────────────────────

  it('should report an ERROR at an include site, with include wording', async () => {
    // `include` runs the partial in the caller's scope, so the value COULD be inherited —
    // but a {% doc %} block is a declared contract, and the ecosystem honours it at include
    // sites: the `can_do_or_*` helpers in pos-module-community are included with every
    // documented param passed explicitly, down to `entity: null`. Only the INFERRED path
    // drops to a warning (`ImplicitIncludeArguments`), because inference cannot tell a
    // deliberately scope-sharing helper from a partial that wanted an argument.
    const offenses = await check(partialWithRequiredParams, `{% include 'card' %}`);

    expect(offenses.map((offense) => [offense.severity, offense.message])).to.deep.equal([
      [Severity.ERROR, "Missing required argument 'title' in include tag for partial 'card'."],
    ]);
  });

  // ─── function tags call documented partials too ───────────────────────────

  it('should report a missing required param in a function tag', async () => {
    const offenses = await runLiquidCheck(
      MissingRenderPartialArguments,
      `{% function a = 'commands/call/fileToCall', variable: 2 %}`,
      undefined,
      {},
      {
        'app/lib/commands/call/fileToCall.liquid': [
          '{% doc %}',
          '  @param {number} variable - param with description',
          '  @param {number} variable2 - param with description',
          '{% enddoc %}',
          '{% assign a = 5 | plus: variable | plus: variable2 %}',
          '{{ a }}',
        ].join('\n'),
      },
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      "Missing required argument 'variable2' in function tag for partial 'commands/call/fileToCall'.",
    ]);
  });

  it('should report a doc-required param the implementation | defaults', async () => {
    // The {% doc %} block is the contract; an internal fallback does not change it. That
    // the source defaults it is doc drift, to be reported on the partial itself.
    const offenses = await runLiquidCheck(
      MissingRenderPartialArguments,
      `{% function res = 'commands/call/fileToCall' %}`,
      undefined,
      {},
      {
        'app/lib/commands/call/fileToCall.liquid': [
          '{% doc %}',
          '  @param {string} message - required by contract',
          '{% enddoc %}',
          "{% assign message = message | default: 'fallback' %}",
          '{{ message }}',
        ].join('\n'),
      },
    );

    expect(offenses.map((offense) => offense.message)).toEqual([
      "Missing required argument 'message' in function tag for partial 'commands/call/fileToCall'.",
    ]);
  });

  it('should not report when a function tag passes every required param', async () => {
    const offenses = await runLiquidCheck(
      MissingRenderPartialArguments,
      `{% function a = 'commands/call/fileToCall', variable: 2, variable2: 12 %}`,
      undefined,
      {},
      {
        'app/lib/commands/call/fileToCall.liquid': [
          '{% doc %}',
          '  @param {number} variable - param with description',
          '  @param {number} variable2 - param with description',
          '{% enddoc %}',
          '{% assign a = 5 | plus: variable | plus: variable2 %}',
          '{{ a }}',
        ].join('\n'),
      },
    );

    expect(offenses.map((offense) => offense.message)).toEqual([]);
  });
});
