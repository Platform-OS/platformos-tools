import { describe, it, expect } from 'vitest';
import { runLiquidCheck, highlightedOffenses } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

describe('Module: InvalidTagSyntax', () => {
  describe('render tag', () => {
    it('should report render without quoted template name', async () => {
      const sourceCode = `{% render %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'render'");
    });

    it('should not report valid render', async () => {
      const sourceCode = `{% render 'partial' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid render with arguments', async () => {
      const sourceCode = `{% render 'partial', var1: 'hello', var2: 123 %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should highlight the entire invalid render tag', async () => {
      const sourceCode = `Hello {% render %} world`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      const highlights = highlightedOffenses(sourceCode, syntaxOffenses);
      expect(highlights).toContain('{% render %}');
    });
  });

  describe('function tag', () => {
    it('should report function without = operator', async () => {
      const sourceCode = `{% function res 'path/to/function' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'function'");
    });

    it('should not report valid function', async () => {
      const sourceCode = `{% function res = 'path/to/function' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid function with arguments', async () => {
      const sourceCode = `{% function res = 'path/to/function', arg1: "hello" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('graphql tag', () => {
    it('should report invalid graphql syntax', async () => {
      const sourceCode = `{% graphql %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'graphql'");
    });

    it('should not report valid graphql file-based syntax', async () => {
      const sourceCode = `{% graphql result = 'path/to/query' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report graphql with named argument value using a filter', async () => {
      const sourceCode = `{% graphql consumers = 'modules/core/events/consumers', name: name | fetch: "admin_liquid_partials" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report graphql with named argument value using chained filters', async () => {
      const sourceCode = `{% graphql consumers = 'modules/core/events/consumers', name: name | fetch: "admin_liquid_partials" | fetch: "results" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report graphql with multiple named arguments where one uses a filter', async () => {
      const sourceCode = `{% graphql consumers = 'modules/core/events/consumers', name: name | fetch: "admin_liquid_partials" | fetch: "results", limit: 10 %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('include tag', () => {
    it('should report include without template name', async () => {
      const sourceCode = `{% include %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'include'");
    });

    it('should not report valid include', async () => {
      const sourceCode = `{% include 'partial' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('platformOS-specific tags', () => {
    it('should not report valid log syntax', async () => {
      const sourceCode = `{% log x %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid export syntax', async () => {
      const sourceCode = `{% export data, namespace: "my_namespace" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid redirect_to syntax', async () => {
      const sourceCode = `{% redirect_to '/path' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid print syntax', async () => {
      const sourceCode = `{% print x %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report valid yield syntax', async () => {
      const sourceCode = `{% yield 'content' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('inside {% liquid %} blocks', () => {
    it('should report invalid render syntax inside liquid block', async () => {
      const sourceCode = `{% liquid
  render
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'render'");
    });

    it('should not report valid tags inside liquid block', async () => {
      const sourceCode = `{% liquid
  render 'partial'
  function res = 'path/to/function'
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('should NOT fire on tags with dedicated sub-checks', () => {
    it('should not fire InvalidTagSyntax on assign (has MultipleAssignValues)', async () => {
      const sourceCode = `{% assign x abc %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not fire InvalidTagSyntax on echo (has InvalidEchoValue)', async () => {
      const sourceCode = `{% echo = %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('should not report tags without expected markup', () => {
    it('should not report else as invalid syntax', async () => {
      const sourceCode = `{% if true %}a{% else %}b{% endif %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report break as invalid syntax', async () => {
      const sourceCode = `{% for item in array %}{% break %}{% endfor %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not report continue as invalid syntax', async () => {
      const sourceCode = `{% for item in array %}{% continue %}{% endfor %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('tags with whitespace-trimming delimiters', () => {
    it('should report invalid syntax with trimming delimiters', async () => {
      const sourceCode = `{%- render -%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'render'");
    });

    it('should not report valid syntax with trimming delimiters', async () => {
      const sourceCode = `{%- render 'partial' -%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('docset syntax hint', () => {
    it('should include syntax hint from docset when available', async () => {
      const sourceCode = `{% render %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode, 'file.liquid', {
        platformosDocset: {
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
            return [{ name: 'render', syntax: "{% render 'partial' %}" }];
          },
          async graphQL() {
            return null;
          },
        },
      });
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(1);
      expect(syntaxOffenses[0].message).toContain("Expected syntax: {% render 'partial' %}");
    });
  });
});
