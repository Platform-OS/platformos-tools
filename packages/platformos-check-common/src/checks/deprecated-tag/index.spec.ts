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
          name: 'include',
          deprecated: true,
          deprecation_reason: "Use the 'render' tag instead.",
        },
        {
          name: 'deprecated_no_reason',
          deprecated: true,
        },
        {
          name: 'render',
        },
      ];
    },
    async systemTranslations() {
      return {};
    },
  },
};

describe('Module: DeprecatedTag', () => {
  it('should report an offense when a deprecated tag is used', async () => {
    const sourceCode = `{% include 'templates/foo.liquid' %}`;

    const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, 'file.liquid', mockDependencies);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include']);
  });

  it('should not report an offense when a non-deprecated tag is used', async () => {
    const sourceCode = `{% render 'templates/foo.liquid' %}`;

    const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, 'file.liquid', mockDependencies);

    expect(offenses).toHaveLength(0);
  });

  it('should report a generic message when no deprecation_reason is provided', async () => {
    const sourceCode = `{% deprecated_no_reason %}`;

    const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, 'file.liquid', mockDependencies);

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(`Deprecated tag 'deprecated_no_reason'.`);
  });

  it('should report multiple offenses when multiple deprecated tags are used', async () => {
    const sourceCode = `
      {% include 'foo.liquid' %}
      {% assign greeting = "hello world" %}
      {% include 'greeting.liquid' %}
    `;

    const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, 'file.liquid', mockDependencies);

    expect(offenses).toHaveLength(2);
    expect(offenses[0].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);
    expect(offenses[1].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include', 'include']);
  });

  it('should highlight only the tag name', async () => {
    const sourceCode = `{% include 'foo.liquid' %}`;

    const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, 'file.liquid', mockDependencies);

    expect(offenses).toHaveLength(1);
    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include']);
  });
});
