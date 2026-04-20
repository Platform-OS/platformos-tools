import { describe, it, expect } from 'vitest';
import { runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

// Runtime-aligned via pos-cli sync against a live staging instance:
//   {{ arr << "el" }}             → sync rejects (parse error in output position)
//   {% echo arr << "el" %}        → same
//   {% assign arr << "el" %}      → sync accepts (only valid position for `<<`)

describe('detectInvalidOutputPush', () => {
  describe('{{ }} output position', () => {
    const invalidCases: Array<[string, string]> = [
      ['string value', `{{ arr << "el" }}`],
      ['single-quoted value', `{{ arr << 'el' }}`],
      ['variable value', `{{ arr << other }}`],
      ['with filter chain', `{{ arr << "el" | upcase }}`],
      ['whitespace-trim delimiters', `{{- arr << "el" -}}`],
    ];

    for (const [label, sourceCode] of invalidCases) {
      it(`should report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
        expect(pushOffenses).toHaveLength(1);
      });
    }

    it('should not fire on plain output without `<<`', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ arr }}`);
      expect(offenses).toHaveLength(0);
    });

    it('should not fire on output with filters', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ arr | upcase }}`);
      expect(offenses).toHaveLength(0);
    });

    it('should not fire when `<<` is inside a quoted string', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ "a << b" }}`);
      expect(offenses).toHaveLength(0);
    });

    it('should not fire when `<<` is inside a single-quoted string', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ 'a << b' }}`);
      expect(offenses).toHaveLength(0);
    });

    it('should not fire when `<<` appears only inside a filter-argument string', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ a | append: " << " }}`);
      expect(offenses).toHaveLength(0);
    });

    it('should suppress the generic InvalidEchoValue duplicate', async () => {
      // Without the dedicated check, InvalidEchoValue would also report "Syntax is not supported".
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{{ arr << "el" }}`);
      expect(offenses).toHaveLength(1);
      expect(offenses[0].message).toContain("'<<' (push) operator");
    });
  });

  describe('{% echo %} tag', () => {
    it('should report push in echo tag', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% echo arr << "el" %}`);
      const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
      expect(pushOffenses).toHaveLength(1);
    });

    it('should not fire on valid echo', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% echo arr %}`);
      expect(offenses).toHaveLength(0);
    });
  });

  describe('assign tag — `<<` remains valid here', () => {
    it('should NOT fire on bare push in assign', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% assign arr << "el" %}`);
      const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
      expect(pushOffenses).toHaveLength(0);
    });

    it('should NOT fire on bare push with variable', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% assign arr << v %}`);
      const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
      expect(pushOffenses).toHaveLength(0);
    });

    it('should NOT fire on bare push with filter', async () => {
      const offenses = await runLiquidCheck(
        LiquidHTMLSyntaxError,
        `{% assign arr << "el" | upcase %}`,
      );
      const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
      expect(pushOffenses).toHaveLength(0);
    });
  });

  describe('other tags', () => {
    it('should not fire for non-echo tags', async () => {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% render 'p' %}`);
      const pushOffenses = offenses.filter((o) => o.message.includes("'<<' (push) operator"));
      expect(pushOffenses).toHaveLength(0);
    });
  });
});
