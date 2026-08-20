import { expect, describe, it } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { highlightedOffenses, runLiquidCheck } from '../../test';
import { Offense, SourceCodeType } from '../../types';
import { visit } from '../../visitor';
import { LiquidHTMLSyntaxError } from './index';

describe('Module: LiquidHTMLSyntaxError', () => {
  it('should report unclosed Liquid tags', async () => {
    const sourceCode = `
      {% capture some_variable %}
        Hello, world!
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses.map((offense) => offense.message)).toEqual([`'capture' tag was never closed`]);
  });

  it('should report unclosed HTML tags', async () => {
    const sourceCode = `
      <a href="abc">
        Hello, world!
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses.map((offense) => offense.message)).toEqual([`'<a>' element was never closed`]);
  });

  it('should report closing the wrong node (html/html)', async () => {
    const sourceCode = `
      <a href="abc">
        Hello, world!
      </b>
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Attempting to close '<b>' element before '<a>' element was closed`,
    );
  });

  it('should report closing the wrong node (html/liquid)', async () => {
    const sourceCode = `
      <a href="abc">
        Hello, world!
      {% endif %}
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Attempting to close 'if' tag before '<a>' element was closed`,
    );
  });

  it('should report unexpected tokens (1)', async () => {
    const sourceCode = `
      {% if cond }}
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(`SyntaxError: expected "%}"`);
  });

  it('should report unexpected tokens (2)', async () => {
    const sourceCode = `
      <a href="abc" "></a>
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(`SyntaxError: expected ">", not """`);
  });

  it('should report unexpected tokens (3)', async () => {
    // This message is Ohm's own "expected one of" list, so it enumerates the grammar's tag
    // alternation verbatim and CHANGES whenever the vocabulary does. It is an encoded
    // defect rather than a contract — nobody chose this wording, and an author reading a
    // 50-item list learns nothing — but it is pinned here, so a vocabulary change has to
    // come past this test rather than slipping through.
    const sourceCode = `
      <a href="abc" {%></a>
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `SyntaxError: expected "#", a letter, "yield", "theme_render_rc", "spam_protection", "sign_in", "session", "rollback", "return", "response_status", "response_headers", "redirect_to", "print", "log", "include_form", "export", "context", "catch", "background", "when", "graphql", "function", "render", "liquid", "increment", "include", "elsif", "else", "echo", "decrement", "cycle", "continue", "break", "hash_assign", "assign", "try", "try_rc", "transaction", "parse_json", "cache", "tablerow", "unless", "if", "ifchanged", "for", "case", "capture", "form", "content_for", "end", "raw", "comment", or "doc"`,
    );
  });

  it('should not report syntax error in valid Liquid code', async () => {
    const sourceCode = `
      {% if some_variable %}
        Hello, world!
      {% endif %}
    `;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.be.empty;
  });

  it('should highligh the error', async () => {
    let offenses: Offense[];
    let highlights: string[];
    let source: string;

    source = `<div><a></b></div>`;
    offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
    highlights = highlightedOffenses({ 'app/views/partials/file.liquid': source }, offenses);
    expect(highlights).to.include('<a></b>');

    source = `<div><a>{% endif %}</div>`;
    offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
    highlights = highlightedOffenses({ 'app/views/partials/file.liquid': source }, offenses);
    expect(highlights).to.include('<a>{% endif %}');

    source = `<a href=abc ">`;
    offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
    highlights = highlightedOffenses({ 'app/views/partials/file.liquid': source }, offenses);
    expect(highlights).to.include('"');
  });
});

/**
 * WHICH TAG OPERANDS ACCEPT A FILTER — the whole adjudication, as fixtures.
 */
describe('Module: filters in tag operands', () => {
  /**
   * Every row carries its own FILTERLESS spelling and the filter names the AST must hold, so
   * the control group and the reachability assertion cannot drift out of sync with this
   * table — the controls used to be a second hand-maintained list, and it was already one row
   * short.
   */
  const ACCEPTED: Array<[label: string, filtered: string, filterless: string, filters: string[]]> =
    [
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
      [
        'render with',
        `{% render 'p' with 'a' | upcase %}`,
        `{% render 'p' with 'a' %}`,
        ['upcase'],
      ],
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
      // `background` had no trailing `liquidFilter*` and its argumentless spelling did not parse
      // at all. Whether the RUNTIME honours them is a different question and a different check's
      // job: measured, only the `graphql` FILE form does, and `FilterWithoutEffect` reports the
      // rest.
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
