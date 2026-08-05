import { expect, describe, it } from 'vitest';
import { highlightedOffenses, runLiquidCheck } from '../../test';
import { DeprecatedTag } from './index';

const mockDependencies = {
  platformosDocset: {
    async graphQL() {
      return null;
    },
    async filters() {
      return [];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async tags() {
      return [
        {
          name: 'hash_assign',
          deprecated: true,
          deprecation_reason: "Use the 'assign' tag instead.",
        },
        {
          name: 'parse_json',
          deprecated: true,
        },
        {
          name: 'render',
        },
      ];
    },
  },
};

describe('Module: DeprecatedTag', () => {
  it('should report an offense when a deprecated tag is used', async () => {
    const sourceCode = `{% hash_assign foo['bar'] = 'baz' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(
      `Deprecated tag 'hash_assign': Use the 'assign' tag instead.`,
    );

    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['hash_assign']);
  });

  it('should not report an offense when a non-deprecated tag is used', async () => {
    const sourceCode = `{% render 'templates/foo.liquid' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(0);
  });

  it('should report a generic message when no deprecation_reason is provided', async () => {
    const sourceCode = `{% parse_json foo %}{}{% endparse_json %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(`Deprecated tag 'parse_json'.`);
  });

  it('should report multiple offenses when multiple deprecated tags are used', async () => {
    const sourceCode = `
      {% hash_assign foo['bar'] = 'baz' %}
      {% assign greeting = "hello world" %}
      {% hash_assign foo['qux'] = 'quux' %}
    `;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(2);
    expect(offenses[0].message).toEqual(
      `Deprecated tag 'hash_assign': Use the 'assign' tag instead.`,
    );
    expect(offenses[1].message).toEqual(
      `Deprecated tag 'hash_assign': Use the 'assign' tag instead.`,
    );

    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['hash_assign', 'hash_assign']);
  });

  it('should highlight only the tag name', async () => {
    const sourceCode = `{% hash_assign foo['bar'] = 'baz' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'app/views/partials/file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    const highlights = highlightedOffenses(
      { 'app/views/partials/file.liquid': sourceCode },
      offenses,
    );
    expect(highlights).toEqual(['hash_assign']);
  });
});
