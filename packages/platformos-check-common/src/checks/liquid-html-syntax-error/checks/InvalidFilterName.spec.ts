import { describe, it, expect } from 'vitest';
import { applyFix, messagesOf, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

/**
 * The message and the FIXED SOURCE are asserted whole, both of them.
 *
 * They used to be asserted by substring — `message).toContain("has trailing characters")`,
 * `fix).toBeDefined()`, `fixedCode).toContain('append')` — and that is not a weaker version
 * of the same test, it is a different and much smaller claim. Measured: with the corrector
 * changed to emit `' | CORRUPTED'` instead of `''`, 13 of this file's 20 tests stayed green,
 * including the one named "should detect and fix append with trailing @ character", because
 * `{{ 'HELLO' | append | CORRUPTED }}` does contain `append` and does not contain `append@`.
 */
const trailing = (filter: string, characters: string) =>
  `Syntax is not supported Filter '${filter}' has trailing characters '${characters}' that should be removed.`;

/** The offense messages, and the source each offense's own fix produces. */
async function report(sourceCode: string) {
  const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

  return {
    messages: messagesOf(offenses),
    fixes: offenses.map((offense) => applyFix(sourceCode, offense)),
  };
}

describe('Module: InvalidFilterName', () => {
  describe('Filters this check must leave alone', () => {
    it('should not report a filter name whose trailing characters are part of the name', async () => {
      const alphanumeric = await report(`{{ 'HELLO' | append123: 'world' }}`);
      const underscore = await report(`{{ 'HELLO' | append_test }}`);
      // The control: the same shape with a character that is NOT part of a name.
      const invalid = await report(`{{ 'HELLO' | append@ }}`);

      expect({
        alphanumeric: alphanumeric.messages,
        underscore: underscore.messages,
        invalid: invalid.messages,
      }).toEqual({
        alphanumeric: [],
        underscore: [],
        invalid: [trailing('append', '@')],
      });
    });

    it('should not report a valid filter, known or unknown to the docset', async () => {
      // An unknown filter name is `UnknownFilter`'s business; this check is about SYNTAX.
      const known = await report(`{{ 'hello' | append: 'world' }}`);
      const unknown = await report(`{{ 'hello' | completely_unknown_filter: 'world' }}`);

      expect({ known: known.messages, unknown: unknown.messages }).toEqual({
        known: [],
        unknown: [],
      });
    });
  });

  describe('Output tags', () => {
    it('should report and fix a special character after the filter name', async () => {
      expect(await report(`{{ 'HELLO' | append@ }}`)).toEqual({
        messages: [trailing('append', '@')],
        fixes: [`{{ 'HELLO' | append }}`],
      });
    });

    it('should report and fix a space followed by characters', async () => {
      expect(await report(`{{ 'HELLO' | append me: 'world' }}`)).toEqual({
        messages: [trailing('append', ' me')],
        fixes: [`{{ 'HELLO' | append: 'world' }}`],
      });
    });
  });

  describe('Filter combinations and chains', () => {
    it('should fix the offending filter and leave the valid one either side of it', async () => {
      const after = await report(`{{ 'test' | downcase | append@: 'world' }}`);
      const before = await report(`{{ 'test' | append!: 'hello' | upcase }}`);
      const spaced = await report(`{{ 'test' | append xyz: 'hello' | upcase }}`);

      expect({ after, before, spaced }).toEqual({
        after: {
          messages: [trailing('append', '@')],
          fixes: [`{{ 'test' | downcase | append: 'world' }}`],
        },
        before: {
          messages: [trailing('append', '!')],
          fixes: [`{{ 'test' | append: 'hello' | upcase }}`],
        },
        spaced: {
          messages: [trailing('append', ' xyz')],
          fixes: [`{{ 'test' | append: 'hello' | upcase }}`],
        },
      });
    });

    it('should report each offending filter of a chain with a fix of its own', async () => {
      // Each fix is applied to the ORIGINAL source, so each leaves the other offense in
      // place — that is what makes them independent corrections rather than one rewrite.
      expect(await report(`{{ 'test' | append@: 'hello' | upcase# }}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{{ 'test' | append: 'hello' | upcase# }}`,
          `{{ 'test' | append@: 'hello' | upcase }}`,
        ],
      });
    });
  });

  describe('Assign tag filters', () => {
    it('should report and fix a trailing character, and a space followed by characters', async () => {
      const special = await report(`{% assign foo = 'HELLO' | append@ %}`);
      const spaced = await report(`{% assign bar = 'HELLO' | append me: 'world' %}`);

      expect({ special, spaced }).toEqual({
        special: {
          messages: [trailing('append', '@')],
          fixes: [`{% assign foo = 'HELLO' | append %}`],
        },
        spaced: {
          messages: [trailing('append', ' me')],
          fixes: [`{% assign bar = 'HELLO' | append: 'world' %}`],
        },
      });
    });

    it('should report each offending filter of an assign chain', async () => {
      expect(await report(`{% assign baz = 'test' | append@: 'hello' | upcase# %}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{% assign baz = 'test' | append: 'hello' | upcase# %}`,
          `{% assign baz = 'test' | append@: 'hello' | upcase %}`,
        ],
      });
    });

    it('should not report on valid assign filters', async () => {
      const offenses = await report(`{% assign valid = 'hello' | append: 'world' | upcase %}`);

      expect(offenses.messages).toEqual([]);
    });
  });

  describe('Echo tag filters', () => {
    it('should report and fix a trailing character, and a space followed by characters', async () => {
      const special = await report(`{% echo 'HELLO' | append@ %}`);
      const spaced = await report(`{% echo 'HELLO' | append me: 'world' %}`);

      expect({ special, spaced }).toEqual({
        special: {
          messages: [trailing('append', '@')],
          fixes: [`{% echo 'HELLO' | append %}`],
        },
        spaced: {
          messages: [trailing('append', ' me')],
          fixes: [`{% echo 'HELLO' | append: 'world' %}`],
        },
      });
    });

    it('should report each offending filter of an echo chain', async () => {
      expect(await report(`{% echo 'test' | append@: 'hello' | upcase# %}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{% echo 'test' | append: 'hello' | upcase# %}`,
          `{% echo 'test' | append@: 'hello' | upcase %}`,
        ],
      });
    });

    it('should not report on valid echo filters', async () => {
      const offenses = await report(`{% echo 'hello' | append: 'world' | upcase %}`);

      expect(offenses.messages).toEqual([]);
    });
  });

  describe('Liquid tag filters', () => {
    // Inside `{% liquid %}` the inner tag carries no delimiters of its own, so the fix has
    // to land at an offset the outer tag decides.
    it('should report and fix an assign and an echo inside a liquid tag', async () => {
      const assigned = await report(
        ['{% liquid', "  assign foo = 'test' | append@: 'hello'", '%}'].join('\n'),
      );
      const echoed = await report(
        ['{% liquid', "  echo 'test' | append@: 'hello'", '%}'].join('\n'),
      );

      expect({ assigned, echoed }).toEqual({
        assigned: {
          messages: [trailing('append', '@')],
          fixes: [['{% liquid', "  assign foo = 'test' | append: 'hello'", '%}'].join('\n')],
        },
        echoed: {
          messages: [trailing('append', '@')],
          fixes: [['{% liquid', "  echo 'test' | append: 'hello'", '%}'].join('\n')],
        },
      });
    });
  });
});
