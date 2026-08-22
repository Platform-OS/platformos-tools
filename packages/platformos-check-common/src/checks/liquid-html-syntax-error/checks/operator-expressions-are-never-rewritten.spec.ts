import { describe, expect, it } from 'vitest';
import { applyFix, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';
import type { Offense } from '../../..';

/**
 * ONE CONTRACT, THREE DETECTORS: `LiquidHTMLSyntaxError` never rewrites an expression the
 * author wrote.
 *
 * Three detectors in this check repair unsupported markup by keeping the first value and
 * discarding the rest — `detectMultipleAssignValues` and `detectInvalidEchoValue` on raw
 * string markup, `detectInvalidBooleanExpressions` on a parsed node. That discard reproduces
 * what platformOS's LAX parser does; measured on a live instance,
 * `{% assign foo = '123' 555 text %}` renders `123`.
 *
 * Reproducing the lax parser is a REPAIR when what follows the first value is stray tokens,
 * and a SILENT REWRITE when it is an operand:
 *
 *   {% assign x = flag ? 'yes' : 'no' %}   became   {% assign x = flag %}
 *   {% assign foo = something == else %}   became   {% assign foo = something %}
 *   {{ flag ? 'yes' : 'no' }}              became   {{ flag }}
 *
 * The deploy converter REJECTS every left-hand column and ACCEPTS every right-hand one, so
 * `pos-cli check run -a` traded a whole-changeset failure for a page that renders a value
 * the author never wrote — and printed "No offenses found" while doing it.
 *
 * The offense must survive: `LiquidHTMLSyntaxError` is in the supervisor's
 * `BLOCKING_CHECKS`, and that block is the only thing between this syntax and a wrong value
 * at runtime. So every case here asserts BOTH halves — reported, and not rewritten — and
 * each group is paired with a control the fix must still repair. A guard wide enough to
 * swallow the offense passes the first half and fails the control.
 */

const MESSAGE = 'Syntax is not supported';
const REPORTED_WITHOUT_FIX = { message: MESSAGE, hasFix: false };
const REPORTED_WITH_FIX = { message: MESSAGE, hasFix: true };

/** The two things this contract is about, and nothing else consumers do not depend on. */
const shape = (offenses: Offense[]) =>
  offenses.map((offense) => ({ message: offense.message, hasFix: !!offense.fix }));

describe('LiquidHTMLSyntaxError reports an operator expression without rewriting it', () => {
  describe('assign, on raw string markup', () => {
    it.each([
      ['ternary', `{% assign x = flag ? 'yes' : 'no' %}`],
      ['ternary with the markers fused to the operands', `{% assign x = a ?b :c %}`],
      ['ternary followed by a filter', `{% assign x = a ? b : c | upcase %}`],
      ['boolean &&', `{% assign x = a && b %}`],
      ['arithmetic', `{% assign x = 1 + 2 %}`],
      ['an operator in leading position', `{% assign x = + 2 %}`],
    ])('reports %s and leaves the source untouched', async (_label, sourceCode) => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(shape(offenses)).toEqual([REPORTED_WITHOUT_FIX]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(sourceCode);
    });

    it.each([
      [`{% assign foo = '123' 555 text %}`, `{% assign foo = '123' %}`],
      [`{% assign foo = '123' 555 text | upcase %}`, `{% assign foo = '123' | upcase %}`],
      // An operator spelled INSIDE a quoted string is data, not an operator.
      [`{% assign foo = 'a?b' 555 %}`, `{% assign foo = 'a?b' %}`],
      [`{% assign foo = "a:b" 555 %}`, `{% assign foo = "a:b" %}`],
      // A negative number is a value; only a bare `-` is an operator.
      [`{% assign foo = -5 555 %}`, `{% assign foo = -5 %}`],
      [`{% assign foo = (1..3) 555 %}`, `{% assign foo = (1..3) %}`],
    ])('CONTROL: still repairs %s', async (sourceCode, expected) => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(shape(offenses)).toEqual([REPORTED_WITH_FIX]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(expected);
    });
  });

  describe('echo and output, on raw string markup', () => {
    it.each([
      ['an output ternary', `{{ flag ? 'yes' : 'no' }}`],
      ['an echo-tag ternary', `{% echo flag ? 'yes' : 'no' %}`],
      ['a liquid-tag echo ternary', `{% liquid echo a ? b : c %}`],
      ['an output ternary followed by a filter', `{{ a ? b : c | upcase }}`],
      ['output arithmetic', `{{ 1 + 2 }}`],
    ])('reports %s and leaves the source untouched', async (_label, sourceCode) => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(shape(offenses)).toEqual([REPORTED_WITHOUT_FIX]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(sourceCode);
    });

    it.each([
      [`{% echo '123' 555 text %}`, `{% echo '123' %}`],
      [`{{ '123' 555 text }}`, `{{ '123' }}`],
      [`{% liquid echo '123' 555 text %}`, `{% liquid echo '123' %}`],
      [`{{ 'a?b' 555 }}`, `{{ 'a?b' }}`],
      [`{{ -5 555 }}`, `{{ -5 }}`],
    ])('CONTROL: still repairs %s', async (sourceCode, expected) => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(shape(offenses)).toEqual([REPORTED_WITH_FIX]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(expected);
    });
  });

  /**
   * These parse into a `BooleanExpression` node rather than staying raw markup, so they are
   * owned by `detectInvalidBooleanExpressions` and never reach the token-level guard. There
   * is no control group here on purpose: a comparison or logical expression is ALWAYS
   * author-written, so this detector has no repairable case to protect — the assertion that
   * it still reports is what stands in for one.
   */
  describe('comparisons and logical expressions, on a parsed node', () => {
    it.each([
      ['equality', `{% assign foo = something == else %}`],
      ['inequality in an echo tag', `{% echo foo != bar %}`],
      ['comparison in an output', `{{ this > that }}`],
      ['the word operator and', `{{ bool and cond }}`],
      ['the word operator or', `{% assign x = a or b %}`],
      ['the word operator contains', `{% assign x = a contains b %}`],
      ['greater-or-equal', `{% assign x = a >= b %}`],
    ])('reports %s and leaves the source untouched', async (_label, sourceCode) => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(shape(offenses)).toEqual([REPORTED_WITHOUT_FIX]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(sourceCode);
    });
  });

  /**
   * The boundary of this contract, pinned so it is a decision rather than an oversight.
   *
   * `||` reads as two pipes, so `InvalidPipeSyntax` owns it and its fix produces
   * `{% assign x = a | b %}`. That is NOT the silent class: measured against the instance,
   * the converter still rejects the result — "Unknown filters: b" — and `UnknownFilter` is
   * itself a blocking check, so the corruption cannot reach a deployed page unnoticed.
   */
  it('leaves the double-pipe repair to InvalidPipeSyntax, whose output still fails loudly', async () => {
    const sourceCode = `{% assign x = a || b %}`;
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

    expect(shape(offenses)).toEqual([
      { message: 'Syntax is not supported. Remove extra `|` character(s).', hasFix: true },
    ]);
    expect(applyFix(sourceCode, offenses[0])).toEqual(`{% assign x = a | b %}`);
  });
});
