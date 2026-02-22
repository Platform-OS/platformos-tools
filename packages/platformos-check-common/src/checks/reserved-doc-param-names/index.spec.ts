import { expect, describe, it } from 'vitest';
import { ReservedDocParamNames } from './index';
import { runLiquidCheck } from '../../test';

describe('Module: ReservedDocParamNames', () => {
  it('should not report an error when no doc params share names with reserved content_for tag params', async () => {
    const sourceCode = `
      {% doc %}
        @param param1 - Example param
      {% enddoc %}
    `;

    const offenses = await runLiquidCheck(
      ReservedDocParamNames,
      sourceCode,
      'app/views/partials/file.liquid',
    );

    expect(offenses).to.be.empty;
  });

  it('should not report an error for partials even when doc param shares a name with reserved content_for tag params', async () => {
    const sourceCode = `
      {% doc %}
        @param param1 - Example param
        @param id - Example param
      {% enddoc %}
    `;

    const offenses = await runLiquidCheck(
      ReservedDocParamNames,
      sourceCode,
      'app/views/partials/file.liquid',
    );

    expect(offenses).to.have.length(0);
  });
});
