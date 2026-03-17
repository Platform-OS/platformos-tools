import { describe, it, expect } from 'vitest';
import { applySuggestions, runLiquidCheck } from '../../test';
import { MissingRenderPartialArguments } from '.';

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

  it('should not report when all required params are provided', async () => {
    const offenses = await check(partialWithRequiredParams, `{% render 'card', title: 'Hello' %}`);
    expect(offenses).to.have.length(0);
  });

  it('should not report for missing optional params', async () => {
    const offenses = await check(partialWithRequiredParams, `{% render 'card', title: 'Hello' %}`);
    expect(offenses).to.have.length(0);
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
});
