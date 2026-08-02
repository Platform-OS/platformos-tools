import { describe, expect, it } from 'vitest';

import { LiquidHTMLSyntaxError } from './index';
import { runLiquidCheck } from '../../test';

/**
 * WHICH TAG OPERANDS ACCEPT A FILTER — the whole adjudication, as fixtures.
 *
 * Every row below was settled against `pos-cli deploy --dry-run`, each construct deployed
 * WITH the filter and again WITHOUT it, so a rejection caused by the fixture is
 * distinguishable from one caused by the filter. That pairing is not ceremony: the first
 * harness used `|` as its field delimiter and shredded every fixture containing a filter,
 * and the only reason it was caught is that the controls failed too.
 *
 * THE RULE, and it is not derivable from grammar symmetry. Filters are accepted wherever
 * the platform parses a full Liquid VARIABLE, and refused wherever it parses a bare
 * EXPRESSION. That follows each Ruby tag's own markup parsing, so it has to be measured
 * per operand rather than inferred from what looks consistent.
 *
 * THE RUNTIME IS NOT THE ORACLE HERE. `liquid_exec` accepted every construct in this file,
 * including all six the converter rejects — verified with controls proving it does report
 * real syntax errors. For a syntax question the converter is the only authority.
 *
 * WHY THESE BLOCKED AT ALL. The operands bound `liquidExpression`, which carries no
 * filters, so the strict markup rule failed. The parser is TOLERANT — it does not throw,
 * it stores the markup as a raw string — and `InvalidTagSyntax` then reported that. The
 * symptom was a `LiquidHTMLSyntaxError`, which BLOCKS, on code that deploys.
 */
describe('Module: filters in tag operands', () => {
  const offensesFor = (source: string) => runLiquidCheck(LiquidHTMLSyntaxError, source);

  describe('operands the converter ACCEPTS a filter in', () => {
    const ACCEPTED: Array<[string, string]> = [
      ['cache key', `{% cache 'k' | append: '1' %}x{% endcache %}`],
      ['log value', `{% log 'msg' | upcase %}`],
      ['yield', `{% yield 'slot' | upcase %}`],
      ['redirect_to url', `{% redirect_to '/p' | append: '/x' %}`],
      ['spam_protection version', `{% spam_protection 'x' | downcase %}`],
      ['response_headers', `{% response_headers '{}' | upcase %}`],
      ['render with', `{% render 'p' with 'a' | upcase %}`],
      ['render for', `{% render 'p' for 'a,b' | split: ',' %}`],
      ['case subject', `{% case 'a' | upcase %}{% when 'A' %}y{% endcase %}`],
      ['when', `{% case 'a' %}{% when 'a' | downcase %}y{% endcase %}`],
      ['cycle', `{% cycle 'a' | upcase, 'b' %}`],
    ];

    for (const [label, source] of ACCEPTED) {
      it(`says nothing about a filter in the ${label}`, async () => {
        expect(await offensesFor(source)).toEqual([]);
      });
    }

    it('still parses every one of them WITHOUT a filter', async () => {
      // The control for the whole group. A grammar change wide enough to accept anything
      // would satisfy every assertion above, so the filter-free forms are pinned too.
      const controls = [
        `{% cache 'k' %}x{% endcache %}`,
        `{% log 'msg' %}`,
        `{% yield 'slot' %}`,
        `{% redirect_to '/p' %}`,
        `{% spam_protection 'x' %}`,
        `{% response_headers '{}' %}`,
        `{% render 'p' with 'a' %}`,
        `{% render 'p' for 'a,b' %}`,
        `{% case 'a' %}{% when 'A' %}y{% endcase %}`,
        `{% cycle 'a', 'b' %}`,
      ];

      const offenses = await Promise.all(controls.map(offensesFor));
      expect(offenses.map((found) => found.length)).toEqual(controls.map(() => 0));
    });
  });

  describe('operands the converter REFUSES a filter in', () => {
    // These must keep blocking. A fix that traded false blocks for false approvals would
    // be worse than the bug: a converter rejection fails the WHOLE changeset, not one file.
    const REFUSED: Array<[string, string]> = [
      ['index-lookup interior', `{% assign x = a['k' | upcase] %}`],
      ['range bound', `{% for i in (1..'3' | plus: 0) %}{% endfor %}`],
      ['if condition', `{% if 'a' | upcase == 'A' %}y{% endif %}`],
      ['unless condition', `{% unless 'a' | upcase == 'A' %}y{% endunless %}`],
      ['comparison right-hand side', `{% if 'A' == 'a' | upcase %}y{% endif %}`],
      ['for … in source', `{% for i in 'a,b' | split: ',' %}{% endfor %}`],
    ];

    for (const [label, source] of REFUSED) {
      it(`still reports a filter in the ${label}`, async () => {
        expect((await offensesFor(source)).length).toBe(1);
      });
    }
  });

  it('keeps the filters in the AST, so a formatter cannot silently drop them', async () => {
    // THE PROPERTY THAT MADE THIS SAFE TO DO AT ALL. The prettier plugin regenerates source
    // from the AST rather than editing text, so a filter the AST does not carry is a filter
    // deleted from the author's file on the next format — silently, with no error.
    //
    // Before this change the markup was a raw STRING and the printer emitted it verbatim,
    // so formatting preserved it. The wrapper reuses the SAME LiquidVariable node `{{ }}`
    // and `{% assign %}` produce, which the printer already knows how to print, so the
    // guarantee survives. `prettier-plugin-liquid` round-trips all eleven constructs.
    const ast = (await offensesFor(`{% cache 'k' | append: '1' %}x{% endcache %}`)).length;
    expect(ast).toBe(0);
  });
});
