import { describe, it, expect } from 'vitest';
import { runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

describe('detectInvalidAssignSyntax', () => {
  describe('structurally-broken assign tags', () => {
    const brokenCases: Array<[string, string]> = [
      ['missing `=` with quoted value', `{% assign x "var" %}`],
      ['missing `=` with bare identifier', `{% assign x abc %}`],
      ['missing target', `{% assign = 'val' %}`],
      ['completely empty', `{% assign %}`],
      ['target only, no operator', `{% assign x %}`],
      ['empty RHS after `=`', `{% assign x = %}`],
    ];

    for (const [label, sourceCode] of brokenCases) {
      it(`should report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
        expect(syntaxOffenses).toHaveLength(1);
        expect(syntaxOffenses[0].message).toContain("Invalid syntax for tag 'assign'");
      });
    }
  });

  describe('invalid targets', () => {
    // Literal delimiters at the start of the target are never a valid assign target.
    // Digit-starting names (e.g. `23_hours_ago`) are accepted by the platformOS runtime
    // even though our parser's `variableSegment` grammar rule falls back on them —
    // to avoid false positives, we do not flag digit-starting targets here.
    const invalidTargetCases: Array<[string, string]> = [
      ['target is a single-quoted string', `{% assign 'str' = 'v' %}`],
      ['target is a double-quoted string', `{% assign "str" = 'v' %}`],
      ['target is an array literal', `{% assign [] = 'v' %}`],
      ['target is a hash literal', `{% assign {} = 'v' %}`],
    ];

    for (const [label, sourceCode] of invalidTargetCases) {
      it(`should report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const syntaxOffenses = offenses.filter((o) =>
          o.message.includes("Invalid syntax for tag 'assign'"),
        );
        expect(syntaxOffenses).toHaveLength(1);
      });
    }

    it('should NOT flag a valid dotted target (parser accepts it)', async () => {
      const sourceCode = `{% assign foo.bar = 'v' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should NOT flag a valid indexed target', async () => {
      const sourceCode = `{% assign foo[0] = 'v' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should NOT flag a digit-starting target (valid per platformOS runtime)', async () => {
      // Liquify accepts `23_hours_ago` as a valid name; our parser falls back to base
      // case but this check must not over-report vs. runtime.
      const sourceCode = `{% assign 23_hours_ago = 'some value' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('operator variants', () => {
    it('should report `:=` (not a recognized operator) as an assign syntax error', async () => {
      const sourceCode = `{% assign x := 'v' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(1);
    });

    it('should have some offense for `==` (MultipleAssignValues handles it)', async () => {
      const sourceCode = `{% assign x == 'v' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses.length).toBeGreaterThan(0);
    });

    it('should have some offense for `=+`', async () => {
      const sourceCode = `{% assign x =+ 'v' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses.length).toBeGreaterThan(0);
    });
  });

  describe('trailing garbage after RHS / filters (fallback)', () => {
    // These cases have a valid `target = value` skeleton and a valid filter chain,
    // but extra non-parseable characters trail the filters. The tolerant parser
    // swallows the entire body as string markup, and none of the other sub-checks
    // (MultipleAssignValues, InvalidFilterName, InvalidPipeSyntax) detects the
    // problem — so the fallback re-parses in strict mode and surfaces it.
    const fallbackCases: Array<[string, string]> = [
      [
        'stray `}` after filter array argument',
        `{% assign name = arr | default: [ "hi", k, v] } %}`,
      ],
      ['trailing bare word after filter arg', `{% assign x = y | default: "z" trailing %}`],
    ];

    for (const [label, sourceCode] of fallbackCases) {
      it(`should report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        const syntaxOffenses = offenses.filter((o) =>
          o.message.includes("Invalid syntax for tag 'assign'"),
        );
        expect(syntaxOffenses).toHaveLength(1);
      });
    }

    // These cases are already flagged by other sub-checks with different messages;
    // the fallback must NOT also fire on them (no double-reporting).
    const alreadyCoveredCases: Array<[string, string]> = [
      [
        'stray `}` after unary filter (InvalidFilterName catches it)',
        `{% assign x = y | upcase } %}`,
      ],
      [
        'stray `}` after RHS with no filter (MultipleAssignValues catches it)',
        `{% assign x = "v" } %}`,
      ],
    ];

    for (const [label, sourceCode] of alreadyCoveredCases) {
      it(`should NOT double-report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        expect(offenses.length).toBeGreaterThan(0);
        const fallbackOffenses = offenses.filter((o) =>
          o.message.includes("Invalid syntax for tag 'assign'"),
        );
        expect(fallbackOffenses).toHaveLength(0);
      });
    }
  });

  describe('valid syntax — should NOT report', () => {
    const validCases: Array<[string, string]> = [
      // primitives
      ['single-quoted string', `{% assign x = 'str' %}`],
      ['double-quoted string', `{% assign x = "str" %}`],
      ['integer', `{% assign x = 42 %}`],
      ['negative float', `{% assign x = -1.5 %}`],
      ['true', `{% assign x = true %}`],
      ['false', `{% assign x = false %}`],
      ['nil', `{% assign x = nil %}`],
      ['null', `{% assign x = null %}`],
      ['blank', `{% assign x = blank %}`],
      ['empty', `{% assign x = empty %}`],
      ['range', `{% assign x = (1..10) %}`],

      // lookups
      ['variable', `{% assign x = other %}`],
      ['dot lookup', `{% assign x = other.prop %}`],
      ['string index lookup', `{% assign x = other["prop"] %}`],
      ['variable index lookup', `{% assign x = other[key] %}`],
      ['deep dot chain', `{% assign x = a.b.c.d %}`],

      // filters
      ['single filter', `{% assign x = y | upcase %}`],
      ['filter with arg', `{% assign x = y | default: 'z' %}`],
      ['chained filters', `{% assign x = y | default: 'z' | upcase %}`],
      ['filter with positional args', `{% assign x = y | append: "a" %}`],
      ['filter with JSON array arg', `{% assign x = y | concat: [1,2] %}`],
      ['filter with JSON hash arg', `{% assign x = y | merge: {a:1} %}`],
      ['chained filter after JSON arg', `{% assign x = y | default: [] | join: "," %}`],

      // JSON hash
      ['empty hash', `{% assign x = {} %}`],
      ['hash with string key', `{% assign x = { "a": 1 } %}`],
      ['hash with bare key', `{% assign x = { a: 1 } %}`],
      ['hash with multiple string keys', `{% assign x = { "a": 1, "b": 2 } %}`],
      ['hash with mixed keys', `{% assign x = { "a": 1, b: 2 } %}`],
      ['hash with nested hash', `{% assign x = { "a": { "nested": true } } %}`],
      ['hash with nested array', `{% assign x = { "a": [1,2,3] } %}`],
      [
        'hash with string-interpolated value',
        `{% assign x = { "email": "{{ email | downcase }}" } %}`,
      ],

      // JSON array
      ['empty array', `{% assign x = [] %}`],
      ['array of numbers', `{% assign x = [1, 2, 3] %}`],
      ['array of strings', `{% assign x = ["a", "b"] %}`],
      ['array of literals', `{% assign x = [true, false, nil] %}`],
      ['array of variables', `{% assign x = [a, b, c] %}`],
      ['nested arrays', `{% assign x = [[1,2],[3,4]] %}`],
      ['array of hashes', `{% assign x = [{"a":1}, {"b":2}] %}`],

      // push syntax — only the bare form `a << value` is valid; `a = b << c`
      // is a compound operator and is NOT accepted by the platformOS runtime.
      ['bare push with string value', `{% assign my_val << "item" %}`],
      ['bare push with variable value', `{% assign my_val << val %}`],
      ['bare push with filter', `{% assign my_val << val | upcase %}`],

      // whitespace-strip
      ['both trim', `{%- assign x = 'v' -%}`],
      ['both trim with hash', `{%- assign x = {} -%}`],
      ['left trim with array', `{%- assign x = [] %}`],
      ['right trim only', `{% assign x = 'v' -%}`],

      // identifiers
      ['underscore prefix', `{% assign _private = 1 %}`],
      ['snake_case', `{% assign snake_case = 1 %}`],
      ['hyphen in identifier', `{% assign my-var = "hello" %}`],
      ['multiple hyphens', `{% assign my-complex-var-name = "test" %}`],
      ['digit in middle', `{% assign x1 = 1 %}`],
    ];

    for (const [label, sourceCode] of validCases) {
      it(`should not report: ${label} — ${sourceCode}`, async () => {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
        expect(offenses).toHaveLength(0);
      });
    }
  });

  describe('interaction with other sub-checks', () => {
    it('should not fire when MultipleAssignValues already reports trailing garbage', async () => {
      const sourceCode = `{% assign foo = '123' 555 text %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) => o.message.includes('Invalid syntax for tag'));
      expect(syntaxOffenses).toHaveLength(0);
      const supportOffenses = offenses.filter((o) => o.message === 'Syntax is not supported');
      expect(supportOffenses).toHaveLength(1);
    });

    it('should not fire on assign with invalid filter name', async () => {
      const sourceCode = `{% assign x = "v" | upcase@ %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not fire on assign with pipe syntax issue', async () => {
      const sourceCode = `{% assign x = "v" || upcase %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(0);
    });

    it('should not fire for non-assign tags', async () => {
      const sourceCode = `{% echo x %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(0);
    });
  });

  describe('inside {% liquid %} blocks', () => {
    it('should accept a simple assign statement', async () => {
      const sourceCode = `{% liquid
  assign x = 1
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should accept a multi-line hash literal', async () => {
      const sourceCode = `{% liquid
  assign h = {
    "a": 1,
    "b": 2
  }
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should accept a multi-line array literal', async () => {
      const sourceCode = `{% liquid
  assign a = [
    "a",
    "b"
  ]
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should accept nested multi-line hash', async () => {
      const sourceCode = `{% liquid
  assign h = {
    outer: {
      inner: "v"
    }
  }
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should not let an empty hash swallow the next statement', async () => {
      const sourceCode = `{% liquid
  assign h = {}
  assign a = 'x'
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should parse subsequent tag cleanly after array', async () => {
      const sourceCode = `{% liquid
  assign a = [1]
  render 'p'
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('should report target-only assign', async () => {
      const sourceCode = `{% liquid
  assign x
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(1);
    });

    it('should report assign with empty RHS', async () => {
      const sourceCode = `{% liquid
  assign x =
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(1);
    });

    it('should report assign without `=`', async () => {
      const sourceCode = `{% liquid
  assign x "v"
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(1);
    });

    it('should report garbage between hash entries as a parse error', async () => {
      const sourceCode = `{% liquid
  assign x = {
    "a": 1
  extra garbage
  }
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses.length).toBeGreaterThan(0);
    });

    it('should report an unclosed hash before `%}` in tolerant mode', async () => {
      const sourceCode = `{% liquid
  assign x = { "a": 1
%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses.length).toBeGreaterThan(0);
    });
  });

  describe('whitespace-trimming delimiters', () => {
    it('should report with trim delimiters', async () => {
      const sourceCode = `{%- assign x "var" -%}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      const syntaxOffenses = offenses.filter((o) =>
        o.message.includes("Invalid syntax for tag 'assign'"),
      );
      expect(syntaxOffenses).toHaveLength(1);
    });
  });

  // These assertions mirror scenarios from the platformOS runtime test suite
  // (desksnearme/test/lib/liquify/tags/assign_tag_test.rb) to make sure our
  // lint-level acceptance aligns with runtime acceptance for common patterns.
  describe('runtime-alignment scenarios', () => {
    it('accepts JSON literal as default filter argument (matches Liquify behavior)', async () => {
      const sourceCode = `{% assign my_val = null | default: [] %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts empty hash as default filter argument', async () => {
      const sourceCode = `{% assign my_hash = null | default: {} %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts hash_merge with two hash arguments', async () => {
      const sourceCode = `{% assign merged = { "a": 1 } | hash_merge: h2 | hash_merge: h3 %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts JSON array with mixed primitive types', async () => {
      const sourceCode = `{% assign arr = ["string", 42, true, null, { "nested": "object" }] %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts JSON hash with escaped double-quote in string value', async () => {
      const sourceCode = `{% assign data = { "quote": "He said \\"hello\\"" } %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts escaped backslash in double-quoted string', async () => {
      const sourceCode = `{% assign x = "path\\\\to\\\\file" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts escaped single-quote in single-quoted string', async () => {
      const sourceCode = `{% assign x = 'can\\'t' %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts deeply nested JSON structures', async () => {
      const sourceCode = `{% assign data = {
        "level1": {
          "level2": {
            "level3": {
              "level4": {
                "value": "deep",
                "array": [1, 2, 3]
              }
            }
          }
        }
      } %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts JSON array of hashes then map/join filters', async () => {
      const sourceCode = `{% assign names = users | map: "name" | join: ", " %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('accepts push syntax — `{% assign v << "x" %}`', async () => {
      const sourceCode = `{% assign my_val << "item" %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).toHaveLength(0);
    });

    it('rejects compound operator — `{% assign a = b << c %}` is invalid', async () => {
      // Per platformOS runtime: an assign uses exactly one of `=` or `<<`, never both.
      // Our parser falls back to base case; check should flag via MAV or IAS.
      const sourceCode = `{% assign a = b << c %}`;
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses.length).toBeGreaterThan(0);
    });
  });
});
