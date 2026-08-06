import { describe, expect, it } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { LiquidHTMLSyntaxError } from './index';
import { runLiquidCheck } from '../../test';
import { SourceCodeType } from '../../types';
import { visit } from '../../visitor';

/**
 * WHICH TAG OPERANDS ACCEPT A FILTER — the whole adjudication, as fixtures.
 *
 * Filters are accepted wherever the platform parses a full Liquid VARIABLE and refused
 * wherever it parses a bare EXPRESSION. That follows each Ruby tag's own markup parsing, so
 * it is measured per operand rather than inferred from grammar symmetry.
 *
 * Settled against `pos-cli deploy --dry-run`, each construct deployed WITH the filter and
 * again WITHOUT it. THE RUNTIME IS NOT THE ORACLE HERE: `liquid_exec` accepted every
 * construct in this file, including all six the converter rejects. For a syntax question the
 * converter is the only authority.
 *
 * These blocked because the operands bound `liquidExpression`, which carries no filters, so
 * the strict markup rule failed, the markup degraded to a raw string, and `InvalidTagSyntax`
 * reported it — a `LiquidHTMLSyntaxError`, which BLOCKS, on code that deploys.
 */

/**
 * Every row carries its own FILTERLESS spelling and the filter names the AST must hold, so the
 * control group and the reachability assertion cannot drift out of sync with this table — the
 * controls used to be a second hand-maintained list, and it was already one row short.
 */
const ACCEPTED: Array<[label: string, filtered: string, filterless: string, filters: string[]]> = [
  [
    'cache key',
    `{% cache 'k' | append: '1' %}x{% endcache %}`,
    `{% cache 'k' %}x{% endcache %}`,
    ['append'],
  ],
  ['log value', `{% log 'msg' | upcase %}`, `{% log 'msg' %}`, ['upcase']],
  ['yield', `{% yield 'slot' | upcase %}`, `{% yield 'slot' %}`, ['upcase']],
  [
    'redirect_to url',
    `{% redirect_to '/p' | append: '/x' %}`,
    `{% redirect_to '/p' %}`,
    ['append'],
  ],
  [
    'spam_protection version',
    `{% spam_protection 'x' | downcase %}`,
    `{% spam_protection 'x' %}`,
    ['downcase'],
  ],
  [
    'response_headers',
    `{% response_headers '{}' | upcase %}`,
    `{% response_headers '{}' %}`,
    ['upcase'],
  ],
  ['render with', `{% render 'p' with 'a' | upcase %}`, `{% render 'p' with 'a' %}`, ['upcase']],
  [
    'render for',
    `{% render 'p' for 'a,b' | split: ',' %}`,
    `{% render 'p' for 'a,b' %}`,
    ['split'],
  ],
  [
    'case subject',
    `{% case 'a' | upcase %}{% when 'A' %}y{% endcase %}`,
    `{% case 'a' %}{% when 'A' %}y{% endcase %}`,
    ['upcase'],
  ],
  [
    'when',
    `{% case 'a' %}{% when 'a' | downcase %}y{% endcase %}`,
    `{% case 'a' %}{% when 'a' %}y{% endcase %}`,
    ['downcase'],
  ],
  ['cycle', `{% cycle 'a' | upcase, 'b' %}`, `{% cycle 'a', 'b' %}`, ['upcase']],
  // TRAILING filters. The converter accepts all four, so blocking them was a false block —
  // `background` had no trailing `liquidFilter*` and its argumentless spelling did not parse at
  // all. Whether the RUNTIME honours them is a different question and a different check's job:
  // measured, only the `graphql` FILE form does, and `FilterWithoutEffect` reports the rest.
  [
    'background result, with arguments',
    `{% background j = 'p', a: 1 | dig: 'x' %}`,
    `{% background j = 'p', a: 1 %}`,
    ['dig'],
  ],
  [
    'background result, no arguments',
    `{% background j = 'p' | dig: 'x' %}`,
    `{% background j = 'p' %}`,
    ['dig'],
  ],
  [
    'function result',
    `{% function r = 'p', a: 1 | dig: 'x' %}`,
    `{% function r = 'p', a: 1 %}`,
    ['dig'],
  ],
  [
    'graphql result',
    `{% graphql g = 'q', a: 1 | dig: 'x' %}`,
    `{% graphql g = 'q', a: 1 %}`,
    ['dig'],
  ],
];

/** Every LiquidFilter name reachable in the AST. */
const filterNamesIn = (source: string) =>
  visit<SourceCodeType.LiquidHtml, string>(toLiquidHtmlAST(source), {
    async LiquidFilter(node) {
      return node.name;
    },
  });

describe('Module: filters in tag operands', () => {
  const offensesFor = (source: string) => runLiquidCheck(LiquidHTMLSyntaxError, source);

  describe('operands the converter ACCEPTS a filter in', () => {
    for (const [label, filtered] of ACCEPTED) {
      it(`says nothing about a filter in the ${label}`, async () => {
        expect(await offensesFor(filtered)).toEqual([]);
      });
    }

    it('still parses every one of them WITHOUT a filter', async () => {
      // The control for the whole group: a grammar change wide enough to accept anything would
      // satisfy every assertion above.
      const found = await Promise.all(
        ACCEPTED.map(async ([label, , filterless]) => [label, await offensesFor(filterless)]),
      );

      expect(found).toEqual(ACCEPTED.map(([label]) => [label, []]));
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

  it('keeps every accepted filter reachable in the AST, so the printer cannot drop it', async () => {
    // The prettier plugin regenerates source from the AST, so a filter the AST does not carry
    // is a filter deleted from the author's file on the next format — silently, with no error.
    // The offense counts above cannot see this: a construct whose markup degrades to a raw
    // string reports no syntax error either, and the printer emits raw strings verbatim.
    const found = await Promise.all(
      ACCEPTED.map(async ([label, filtered]) => [label, await filterNamesIn(filtered)]),
    );

    expect(found).toEqual(ACCEPTED.map(([label, , , filters]) => [label, filters]));
  });
});
