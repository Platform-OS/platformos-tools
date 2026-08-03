import { expect, describe, it } from 'vitest';
import { highlightedOffenses, runLiquidCheck } from '../../test';
import { Severity } from '../../types';
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
  },
};

describe('Module: DeprecatedTag', () => {
  it('should report an offense when a deprecated tag is used', async () => {
    const sourceCode = `{% include 'templates/foo.liquid' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include']);
  });

  it('should not report an offense when a non-deprecated tag is used', async () => {
    const sourceCode = `{% render 'templates/foo.liquid' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(0);
  });

  it('should report a generic message when no deprecation_reason is provided', async () => {
    const sourceCode = `{% deprecated_no_reason %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toEqual(`Deprecated tag 'deprecated_no_reason'.`);
  });

  it('should report multiple offenses when multiple deprecated tags are used', async () => {
    const sourceCode = `
      {% include 'foo.liquid' %}
      {% assign greeting = "hello world" %}
      {% include 'greeting.liquid' %}
    `;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(2);
    expect(offenses[0].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);
    expect(offenses[1].message).toEqual(`Deprecated tag 'include': Use the 'render' tag instead.`);

    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include', 'include']);
  });

  it('should highlight only the tag name', async () => {
    const sourceCode = `{% include 'foo.liquid' %}`;

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      'file.liquid',
      mockDependencies,
    );

    expect(offenses).toHaveLength(1);
    const highlights = highlightedOffenses({ 'file.liquid': sourceCode }, offenses);
    expect(highlights).toEqual(['include']);
  });

  /**
   * TASK-56. These run against the REAL docset rather than the mock above, because the
   * behaviour under test is produced by the augmentation: the platform registers several
   * tags under a second name, the official docs list none of them, and
   * `AugmentedPlatformOSDocset` injects them with the deprecation the registry states.
   *
   * The pairing matters. Fixing the false block on these eight tags means `UnknownTag` is
   * now SILENT for `{% render_form %}`, and silence is the wrong answer for a spelling the
   * platform itself calls a backwards-compatibility shim. `DeprecatedTag` is where that
   * belongs — a WARNING, which does not block — so the author is told to move without being
   * refused.
   */
  describe('aliases the platform registers for backwards compatibility', () => {
    it('warns on a deprecated alias and names the canonical tag', async () => {
      const sourceCode = `{% render_form 'my_form' %}`;

      const offenses = await runLiquidCheck(DeprecatedTag, sourceCode);

      expect(offenses.map((offense) => offense.message)).toEqual([
        "Deprecated tag 'render_form': use `{% include_form %}` instead " +
          '(the platform\'s registry says "For semi-backwards compatibility, for now...").',
      ]);
      expect(highlightedOffenses({ 'file.liquid': sourceCode }, offenses)).toEqual(['render_form']);
    });

    it('warns rather than blocks', async () => {
      // The severity IS the point. `LiquidHTMLSyntaxError` — which used to report these as
      // unknown tags — is an ERROR and blocks the write; this check is a WARNING and does
      // not. If this ever became an error, the fix would have reintroduced the defect it
      // was written to remove.
      const offenses = await runLiquidCheck(DeprecatedTag, `{% return_rc value %}`);

      expect(offenses.map((offense) => offense.severity)).toEqual([Severity.WARNING]);
    });

    it('stays silent for an alias the registry does NOT mark', async () => {
      // THE CONTROL. `context_rc` is as much an alias as `render_form` — same handler class
      // as `context` — but the platform wrote no comment beside it. Warning here would mean
      // the deprecation was inferred from the `_rc` suffix rather than measured, and would
      // put a warning on code the platform has said nothing against.
      const offenses = await runLiquidCheck(DeprecatedTag, `{% context_rc language: 'de' %}`);

      expect(offenses).toEqual([]);
    });

    it('stays silent for the canonical spelling', async () => {
      // The other half of the control: the remedy must not itself be reported, or the
      // warning would be advice an author cannot act on.
      const offenses = await runLiquidCheck(DeprecatedTag, `{% include_form 'my_form' %}`);

      expect(offenses).toEqual([]);
    });
  });
});
