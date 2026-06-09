import { describe, expect, it } from 'vitest';
import { Severity } from '../../types';
import { runLiquidCheck } from '../../test';
import { GraphqlMultilineInLiquidBlock } from './index';

describe('Module: GraphqlMultilineInLiquidBlock', () => {
  it('flags a multi-line graphql call inside a {% liquid %} block (args stranded on the next line)', async () => {
    const sourceCode = [
      '{% liquid',
      "  graphql result = 'get_items', limit: 10,",
      '  offset: 20',
      '%}',
    ].join('\n');

    const offenses = await runLiquidCheck(GraphqlMultilineInLiquidBlock, sourceCode);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].check).toEqual('GraphqlMultilineInLiquidBlock');
    expect(offenses[0].severity).toEqual(Severity.ERROR);
  });

  it('does not flag the single-line {% graphql %} tag form', async () => {
    const sourceCode = "{% graphql result = 'get_items', limit: 10, offset: 20 %}";

    const offenses = await runLiquidCheck(GraphqlMultilineInLiquidBlock, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('does not flag an inline graphql in a {% liquid %} block with no trailing comma', async () => {
    const sourceCode = ['{% liquid', "  graphql result = 'get_items'", '%}'].join('\n');

    const offenses = await runLiquidCheck(GraphqlMultilineInLiquidBlock, sourceCode);

    expect(offenses).toEqual([]);
  });

  it('does not flag a trailing comma that is not followed by a named argument', async () => {
    const sourceCode = ['{% liquid', "  graphql result = 'get_items', limit: 10", '%}'].join('\n');

    const offenses = await runLiquidCheck(GraphqlMultilineInLiquidBlock, sourceCode);

    expect(offenses).toEqual([]);
  });
});
