import { expect, describe, it } from 'vitest';
import { highlightedOffenses, runLiquidCheck } from '../../test';
import { DeprecatedFilter } from './index';

const mockDependencies = {
  platformosDocset: {
    async graphQL() {
      return null;
    },
    async filters() {
      return [
        {
          name: 'old_filter',
          deprecated: true,
          deprecation_reason: '`old_filter` has been replaced by [`new_filter`](/docs/...).',
        },
        {
          name: 'deprecated_no_replacement',
          deprecated: true,
        },
        {
          name: 'new_filter',
        },
        {
          name: 'active_filter',
        },
      ];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async tags() {
      return [];
    },
  },
};

describe('Module: DeprecatedFilter', () => {
  it('should report an offense when a deprecated filter is used', async () => {
    const sourceCode = `
      {{ value | old_filter }}
      {{ value | old_filter: 'arg' }}
    `;

    const offenses = await runLiquidCheck(DeprecatedFilter, sourceCode, 'file.liquid', mockDependencies);
    expect(offenses.map((e) => e.message)).toEqual([
      "Deprecated filter 'old_filter', consider using 'new_filter'.",
      "Deprecated filter 'old_filter', consider using 'new_filter'.",
    ]);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['| old_filter', "| old_filter: 'arg'"]);
  });

  it('should not report an offense when a non-deprecated filter is used', async () => {
    const sourceCode = `
      {{ value | active_filter }}
      {{ value | new_filter }}
    `;

    const offenses = await runLiquidCheck(DeprecatedFilter, sourceCode, 'file.liquid', mockDependencies);
    expect(offenses).toHaveLength(0);
  });

  it('should report a message without replacement when no alternative exists', async () => {
    const sourceCode = `{{ value | deprecated_no_replacement }}`;

    const offenses = await runLiquidCheck(DeprecatedFilter, sourceCode, 'file.liquid', mockDependencies);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual("Deprecated filter 'deprecated_no_replacement'.");
  });

  it('should report multiple offenses for multiple deprecated filter usages', async () => {
    const sourceCode = `{{ a | old_filter }} {{ b | deprecated_no_replacement }}`;

    const offenses = await runLiquidCheck(DeprecatedFilter, sourceCode, 'file.liquid', mockDependencies);
    expect(offenses).toHaveLength(2);
  });
});
