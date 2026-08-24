import { describe, expect, it } from 'vitest';
import { applyFix, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';

describe('detectTrailingAssignValue', async () => {
  it('should not report when there are no trailing values', async () => {
    const testCases = [`{% assign foo = '123' %}`, `{% assign foo = '123' | upcase %}`];

    for (const sourceCode of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).to.have.length(0);
    }
  });

  /**
   * These cases used to pin the OUTPUT of an autofix that replaced the whole expression with
   * its left operand — `{% assign foo = something == else %}` → `{% assign foo = something %}`
   * — so the test asserted the defect was correct. The converter rejects the input and
   * accepts that output, which is how `pos-cli check run -a` silently rewrote a blocked file
   * into a working one holding a value nobody wrote.
   *
   * The detector now reports without fixing. The full contract, with its controls, lives in
   * `operator-expressions-are-never-rewritten.spec.ts`; what is pinned here is that this
   * detector keeps firing on every form it owns.
   */
  it('should report all use of boolean expressions, without rewriting them', async () => {
    const testCases = [
      `{% assign foo = something == else %}`,
      `{% echo foo != bar %}`,
      `{{ this > that }}`,
      `{{ bool and cond }}`,
    ];

    for (const sourceCode of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

      expect(
        offenses.map((offense) => ({ message: offense.message, hasFix: !!offense.fix })),
      ).toEqual([{ message: 'Syntax is not supported', hasFix: false }]);
      expect(applyFix(sourceCode, offenses[0])).toEqual(sourceCode);
    }
  });
});
