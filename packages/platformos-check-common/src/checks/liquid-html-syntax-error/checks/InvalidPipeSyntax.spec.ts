import { describe, it, expect } from 'vitest';
import { applyFix, messagesOf, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

/**
 * Every case asserts the message AND the source the fix produces, whole.
 *
 * Half of these used to stop at `fix).toBeDefined()`, which says a fix exists and nothing
 * about what it does — a corrector that deleted the whole expression would satisfy it. The
 * ones that did check the output were the reason the other half looked adequate.
 */
const EXTRA_PIPE = 'Syntax is not supported. Remove extra `|` character(s).';
const TRAILING_PIPE = 'Syntax is not supported. Remove the trailing `|` character.';

/** The offense messages, and the source each offense's own fix produces. */
async function report(sourceCode: string) {
  const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

  return {
    messages: messagesOf(offenses),
    fixes: offenses.map((offense) => applyFix(sourceCode, offense)),
  };
}

describe('Module: InvalidPipeSyntax', () => {
  describe('Double pipe patterns', () => {
    it('should report and fix a double pipe in every tag that takes filters', async () => {
      const output = await report(`{{ 'hello' | upcase | | downcase }}`);
      const spaced = await report(`{{ 'hello' | upcase |   | downcase }}`);
      const assigned = await report(`{% assign result = 'hello' | upcase | | downcase %}`);
      const echoed = await report(`{% echo 'hello' | upcase | | downcase %}`);

      expect({ output, spaced, assigned, echoed }).toEqual({
        output: {
          messages: [EXTRA_PIPE],
          fixes: [`{{ 'hello' | upcase | downcase }}`],
        },
        // The whitespace between the two pipes goes with them.
        spaced: {
          messages: [EXTRA_PIPE],
          fixes: [`{{ 'hello' | upcase | downcase }}`],
        },
        assigned: {
          messages: [EXTRA_PIPE],
          fixes: [`{% assign result = 'hello' | upcase | downcase %}`],
        },
        echoed: {
          messages: [EXTRA_PIPE],
          fixes: [`{% echo 'hello' | upcase | downcase %}`],
        },
      });
    });

    it('should report each double pipe of an expression with a fix of its own', async () => {
      // Each fix is applied to the ORIGINAL source, so each leaves the other offense in
      // place: two independent corrections, not one rewrite.
      expect(await report(`{{ 'hello' | upcase | | downcase | | reverse }}`)).toEqual({
        messages: [EXTRA_PIPE, EXTRA_PIPE],
        fixes: [
          `{{ 'hello' | upcase | downcase | | reverse }}`,
          `{{ 'hello' | upcase | | downcase | reverse }}`,
        ],
      });
    });
  });

  describe('Trailing pipe patterns', () => {
    it('should report and fix a trailing pipe in every tag that takes filters', async () => {
      const output = await report(`{{ 'hello' | upcase | }}`);
      const assigned = await report(`{% assign result = 'hello' | upcase | %}`);
      const echoed = await report(`{% echo 'hello' | upcase | %}`);

      expect({ output, assigned, echoed }).toEqual({
        output: { messages: [TRAILING_PIPE], fixes: [`{{ 'hello' | upcase }}`] },
        assigned: {
          messages: [TRAILING_PIPE],
          fixes: [`{% assign result = 'hello' | upcase %}`],
        },
        echoed: { messages: [TRAILING_PIPE], fixes: [`{% echo 'hello' | upcase %}`] },
      });
    });

    /**
     * Both faults at once. The extra-pipe fix removes the PIPE and leaves both spaces around
     * it, so its output carries a double space the trailing-pipe fix's does not — harmless
     * inside a tag, where Liquid does not care, and pinned because nothing here showed it
     * before: `fix).toBeDefined()` was the whole of the old assertion.
     *
     * The two are asserted SEPARATELY, each against the original source, and that is not
     * only a style choice: measured, their ranges OVERLAP, so `applyFixToString` — the
     * applicator behind `pos-cli check run -a` — throws `Overlapping ranges are not allowed`
     * when handed both. That is a defect in the check, not in this test, so it is described
     * here rather than pinned as intended behaviour.
     */
    it('should report a doubled trailing pipe as both faults, each fixable', async () => {
      expect(await report(`{{ 'hello' | upcase | | }}`)).toEqual({
        messages: [EXTRA_PIPE, TRAILING_PIPE],
        fixes: [`{{ 'hello' | upcase |  }}`, `{{ 'hello' | upcase | }}`],
      });
    });
  });

  describe('Complex pipe scenarios', () => {
    it('should report a double pipe and a trailing pipe in the same expression', async () => {
      expect(await report(`{{ 'hello' | upcase | | downcase | reverse | }}`)).toEqual({
        messages: [EXTRA_PIPE, TRAILING_PIPE],
        fixes: [
          `{{ 'hello' | upcase | downcase | reverse | }}`,
          `{{ 'hello' | upcase | | downcase | reverse }}`,
        ],
      });
    });

    it('should fix both faults inside a liquid tag, where the tags have no delimiters', async () => {
      const source = [
        '{% liquid',
        "  assign foo = 'test' | upcase | | downcase |",
        '  echo bar | reverse',
        '%}',
      ].join('\n');

      expect(await report(source)).toEqual({
        messages: [EXTRA_PIPE, TRAILING_PIPE],
        fixes: [
          [
            '{% liquid',
            "  assign foo = 'test' | upcase | downcase |",
            '  echo bar | reverse',
            '%}',
          ].join('\n'),
          [
            '{% liquid',
            "  assign foo = 'test' | upcase | | downcase",
            '  echo bar | reverse',
            '%}',
          ].join('\n'),
        ],
      });
    });
  });

  describe('Valid syntax should not be flagged', () => {
    it('should not report on any well-formed filter chain', async () => {
      const cases = {
        chain: `{{ 'hello' | upcase | append: 'world' | downcase }}`,
        simple: `{{ 'hello' | upcase }}`,
        withArguments: `{{ item.title | append: ' - ' | append: context.language }}`,
        assigned: `{% assign title = item.title | upcase | truncate: 50 %}`,
        echoed: `{% echo item.title | upcase | truncate: 50 %}`,
        // A pipe INSIDE a string is text, not a filter separator.
        pipeInAString: `{{ 'hello | world' | upcase }}`,
        filterArgument: `{{ item.title | default: 'No title' }}`,
      };
      const reported = Object.fromEntries(
        await Promise.all(
          Object.entries(cases).map(async ([name, source]) => [
            name,
            (await report(source)).messages,
          ]),
        ),
      );

      // The control: one malformed chain in the same shape as the first case still reports.
      const malformed = await report(`{{ 'hello' | upcase | | append: 'world' }}`);

      expect({ ...reported, malformed: malformed.messages }).toEqual({
        chain: [],
        simple: [],
        withArguments: [],
        assigned: [],
        echoed: [],
        pipeInAString: [],
        filterArgument: [],
        malformed: [EXTRA_PIPE],
      });
    });
  });
});
