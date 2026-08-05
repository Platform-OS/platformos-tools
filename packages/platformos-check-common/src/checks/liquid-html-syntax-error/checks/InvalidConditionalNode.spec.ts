import { expect, describe, it } from 'vitest';
import { runLiquidCheck, applyFix } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';

describe('Module: InvalidConditionalBooleanExpression', () => {
  it('should not report an offense for valid boolean expressions', async () => {
    const testCases = [
      '{% if 1 > 2 %}hello{% endif %}',
      '{% if variable == 5 %}hello{% endif %}',
      "{% if 'abc' contains 'a' %}hello{% endif %}",
      "{% if product.title != '' %}hello{% endif %}",
      '{% if 1 and 2 %}hello{% endif %}',
      '{% if true or false %}hello{% endif %}',
      '{% if 10 > 5 and user.active %}hello{% endif %}',
      '{% if price >= 100 or discount %}hello{% endif %}',
      "{% if user.name contains 'admin' or user.role == 'owner' %}hello{% endif %}",
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });

  it('should not report an offense for valid single values', async () => {
    const testCases = [
      '{% if variable %}hello{% endif %}',
      '{% if user.active %}hello{% endif %}',
      '{% if true %}hello{% endif %}',
      '{% if false %}hello{% endif %}',
      '{% if 1 %}hello{% endif %}',
      '{% if 0 %}hello{% endif %}',
      "{% if 'string' %}hello{% endif %}",
      '{% if contains %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });

  it('should report an offense when parser stops at numbers', async () => {
    const source = '{% if 7 1 > 100 %}hello{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Syntax is not supported: Expression stops at truthy value '7', and will ignore: '1 > 100'",
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% if 7 %}hello{% endif %}');
  });

  it('should report an offense when parser stops at strings', async () => {
    const source = "{% if 'hello' 1 > 100 %}world{% endif %}";
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Syntax is not supported: Expression stops at truthy value ''hello'', and will ignore: '1 > 100'",
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal("{% if 'hello' %}world{% endif %}");
  });

  it('should report an offense when parser stops at liquid literals', async () => {
    const testCases = [
      { source: '{% if true 1 > 0 %}hello{% endif %}', value: 'true' },
      { source: '{% if false 1 > 0 %}hello{% endif %}', value: 'false' },
      { source: '{% if nil 6 > 5 %}hello{% endif %}', value: 'nil' },
      { source: '{% if empty 123 456 %}hello{% endif %}', value: 'empty' },
      { source: '{% if blank 789 %}hello{% endif %}', value: 'blank' },
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase.source);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain(
        `Expression stops at truthy value '${testCase.value}'`,
      );

      const fixed = applyFix(testCase.source, offenses[0]);
      expect(fixed).to.equal(`{% if ${testCase.value} %}hello{% endif %}`);
    }
  });

  it('should report offenses in different liquid tag types', async () => {
    const testCases = [
      '{% if 7 1 > 100 %}hello{% endif %}',
      "{% unless 'test' 42 > 0 %}hello{% endunless %}",
      '{% if false %}no{% elsif 7 1 > 100 %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain('Expression stops at truthy value');
    }
  });

  it('should report an offense for malformed expression starting with invalid token', async () => {
    const source = '{% if > 2 %}hello{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Syntax is not supported: Conditional cannot start with '>'. Use a variable or value instead",
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% if false %}hello{% endif %}');
  });

  it('should report an offense for bare operators with no operands', async () => {
    const testCases = [
      { source: '{% if > %}hello{% endif %}', token: '>' },
      { source: '{% if == %}hello{% endif %}', token: '==' },
      { source: '{% if < %}hello{% endif %}', token: '<' },
      { source: '{% if != %}hello{% endif %}', token: '!=' },
      { source: '{% if >= %}hello{% endif %}', token: '>=' },
      { source: '{% if <= %}hello{% endif %}', token: '<=' },
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase.source);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain(`Conditional cannot start with '${testCase.token}'`);

      const fixed = applyFix(testCase.source, offenses[0]);
      expect(fixed).to.equal('{% if false %}hello{% endif %}');
    }
  });

  it('should report an offense for other invalid starting characters', async () => {
    const testCases = [
      { source: '{% if @ %}hello{% endif %}', token: '@' },
      { source: '{% if # %}hello{% endif %}', token: '#' },
      { source: '{% if $ %}hello{% endif %}', token: '$' },
      { source: '{% if & %}hello{% endif %}', token: '&' },
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase.source);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain(`Conditional cannot start with '${testCase.token}'`);

      const fixed = applyFix(testCase.source, offenses[0]);
      expect(fixed).to.equal('{% if false %}hello{% endif %}');
    }
  });

  it('should report an offense for malformed expressions in complex expressions', async () => {
    const testCases = [
      '{% if > 5 and true %}hello{% endif %}',
      '{% if == 2 or false %}hello{% endif %}',
      '{% if < 10 and variable %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain('Conditional cannot start with');

      const fixed = applyFix(testCase, offenses[0]);
      expect(fixed).to.equal('{% if false %}hello{% endif %}');
    }
  });

  it('should report an offense for trailing tokens after comparison', async () => {
    const source = '{% if 1 == 2 foobar %}hello{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "Syntax is not supported: Conditional is invalid. Anything after '1 == 2' will be ignored",
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% if 1 == 2 %}hello{% endif %}');
  });

  it('should report an offense for malformed comparisons like missing quotes', async () => {
    const testCases = [
      {
        source: "{% if 'wat' == 'squat > 2 %}hello{% endif %}",
        description: 'missing closing quote creates trailing comparison',
      },
      {
        source: "{% if 'wat' == 'squat' > 2 %}hello{% endif %}",
        description: 'extra comparison after valid comparison',
      },
      {
        source: "{% if price == 'test' != 5 %}hello{% endif %}",
        description: 'chained comparisons without logical operators',
      },
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase.source);
      expect(offenses, `Failed for: ${testCase.description}`).to.have.length(1);
      expect(offenses[0].message).to.contain('Anything after');
    }
  });

  it('should report an offense for multiple trailing tokens', async () => {
    const source = '{% if 10 > 4 baz qux %}hello{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.contain('Anything after');

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% if 10 > 4 %}hello{% endif %}');
  });

  it('should report an offense for trailing junk with different operators', async () => {
    const testCases = [
      "{% if 'abc' contains 'a' noise %}hello{% endif %}",
      '{% if price <= 50 extra %}hello{% endif %}',
      '{% if count != 0 junk %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain('Anything after');
    }
  });

  it('should not report an offense for valid logical continuations', async () => {
    const testCases = [
      '{% if 1 > 0 and 2 < 3 %}hello{% endif %}',
      '{% if x == 5 or y != 10 %}hello{% endif %}',
      '{% if price >= 100 and discount %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });

  it('should not report an offense for truthy values followed by logical operators', async () => {
    const testCases = [
      '{% if true and variable %}hello{% endif %}',
      '{% if false or variable %}hello{% endif %}',
      '{% if 1 and user.active %}hello{% endif %}',
      '{% if 0 or fallback %}hello{% endif %}',
      "{% if 'string' and condition %}hello{% endif %}",
      "{% if 'value' or default %}hello{% endif %}",
      '{% if 42 and check %}hello{% endif %}',
      '{% if 3.14 or backup %}hello{% endif %}',
      '{% if nil and something %}hello{% endif %}',
      '{% if empty or alternative %}hello{% endif %}',
      '{% if blank and other %}hello{% endif %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });

  it('should not report an offense for complex expressions with truthy values and logical operators', async () => {
    const testCases = [
      '{% if true and variable > 5 %}hello{% endif %}',
      "{% if 'test' or user.name == 'admin' %}hello{% endif %}",
      '{% if 42 and price <= 100 %}hello{% endif %}',
      '{% if false or count != 0 %}hello{% endif %}',
      "{% if empty and product.title contains 'sale' %}hello{% endif %}",
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });

  it('should report an offense for unknown operators after values', async () => {
    const testCases = [
      { source: '{% if my_var word > 5 %}hello{% endif %}', operator: 'word' },
      { source: '{% if jake johnson > 5 %}hello{% endif %}', operator: 'johnson' },
      { source: "{% if 'test' invalid > thing %}hello{% endif %}", operator: 'invalid' },
      { source: "{% if user.name custom 'admin' %}hello{% endif %}", operator: 'custom' },
    ];

    for (const { source, operator } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Unknown operator '${operator}'. Valid operators are: ==, !=, >, <, >=, <=, contains`,
      );
    }
  });

  it('should report an offense for unknown operators after variables', async () => {
    const testCases = [
      { source: '{% if variable unknown > 5 %}hello{% endif %}', operator: 'unknown' },
      { source: "{% if user.role badop 'admin' %}hello{% endif %}", operator: 'badop' },
      { source: '{% if price fake 100 %}hello{% endif %}', operator: 'fake' },
      { source: '{% if "str" blue == something %}hello{% endif %}', operator: 'blue' },
      { source: '{% if red blue > something %}hello{% endif %}', operator: 'blue' },
    ];

    for (const { source, operator } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Unknown operator '${operator}'. Valid operators are: ==, !=, >, <, >=, <=, contains`,
      );
    }
  });

  it('should report an offense for unknown operators in complex expressions', async () => {
    const testCases = [
      { source: "{% if user.active and name fake 'test' %}hello{% endif %}", operator: 'fake' },
      { source: "{% unless 'test' some > thing %}hello{% endunless %}", operator: 'some' },
    ];

    for (const { source, operator } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Unknown operator '${operator}'. Valid operators are: ==, !=, >, <, >=, <=, contains`,
      );
    }
  });

  it('should report an offense and fix misspelled comparison operators', async () => {
    const testCases = [
      {
        source: '{% if var ctn "hello" %}x{% endif %}',
        operator: 'ctn',
        suggestion: 'contains',
        fixed: '{% if var contains "hello" %}x{% endif %}',
      },
      {
        source: '{% if var cotains "hello" %}x{% endif %}',
        operator: 'cotains',
        suggestion: 'contains',
        fixed: '{% if var contains "hello" %}x{% endif %}',
      },
      {
        source: '{% if a = b %}x{% endif %}',
        operator: '=',
        suggestion: '==',
        fixed: '{% if a == b %}x{% endif %}',
      },
      {
        source: '{% if a nad b %}x{% endif %}',
        operator: 'nad',
        suggestion: 'and',
        fixed: '{% if a and b %}x{% endif %}',
      },
    ];

    for (const { source, operator, suggestion, fixed } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Unknown operator '${operator}'. Valid operators are: ==, !=, >, <, >=, <=, contains. Did you mean '${suggestion}'?`,
      );
      expect(applyFix(source, offenses[0])).to.equal(fixed);
    }
  });

  it('should report an offense for unknown operators in unless and elsif', async () => {
    const testCases = [
      '{% unless var ctn "hello" %}x{% endunless %}',
      '{% if a %}x{% elsif var ctn "hello" %}z{% endif %}',
    ];

    for (const source of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Unknown operator 'ctn'. Valid operators are: ==, !=, >, <, >=, <=, contains. Did you mean 'contains'?`,
      );
    }
  });

  it('should report an offense for unknown operators inside liquid statement blocks', async () => {
    const source = '{% liquid\nif var ctn "hello"\n  echo "x"\nendif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: Unknown operator 'ctn'. Valid operators are: ==, !=, >, <, >=, <=, contains. Did you mean 'contains'?`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% liquid\nif var contains "hello"\n  echo "x"\nendif %}');
  });

  it('should report an offense for adjacent values with no operator between them', async () => {
    const source = '{% if a b %}x{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: Unknown operator 'b'. Valid operators are: ==, !=, >, <, >=, <=, contains`,
    );
    expect(offenses[0].fix).to.equal(undefined);
  });

  it('should report an offense for unreadable junk in operator position after variables', async () => {
    const source = '{% unless mentioned_ids ||nonoperator profile_id %}x{% endunless %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: Conditional is invalid. Anything after 'mentioned_ids' will be ignored. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% unless mentioned_ids %}x{% endunless %}');
  });

  it('should report an offense for junk in operator position inside compound conditions in liquid statement blocks', async () => {
    const source =
      '{% liquid\nunless profile_id == event.actor.id or mentioned_ids ||nonoperator profile_id\n  assign mentioned_ids = mentioned_ids | add_to_array: profile_id\nendunless %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: Conditional is invalid. Anything after 'profile_id == event.actor.id or mentioned_ids' will be ignored. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal(
      '{% liquid\nunless profile_id == event.actor.id or mentioned_ids\n  assign mentioned_ids = mentioned_ids | add_to_array: profile_id\nendunless %}',
    );
  });

  it('should report special message for JavaScript-style operators after variables', async () => {
    const source = '{% if a && b %}hello{% endif %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: Conditional is invalid. Anything after 'a' will be ignored. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% if a %}hello{% endif %}');
  });

  it('should report an offense for filter pipes in conditions', async () => {
    const testCases = [
      {
        source: '{% if wat | something == something %}hello{% endif %}',
        prefix: 'wat',
        fixed: '{% if wat %}hello{% endif %}',
      },
      {
        source:
          '{% if members contains mentioned_id or owners | contains mentioned_id %}x{% endif %}',
        prefix: 'members contains mentioned_id or owners',
        fixed: '{% if members contains mentioned_id or owners %}x{% endif %}',
      },
    ];

    for (const { source, prefix, fixed } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Conditional is invalid. Anything after '${prefix}' will be ignored. Filters are not supported in conditions`,
      );
      expect(applyFix(source, offenses[0])).to.equal(fixed);
    }
  });

  it('should report an offense when a condition after and/or starts with an operator', async () => {
    const testCases = [
      { source: '{% if a and == b %}x{% endif %}', token: '==' },
      { source: '{% unless a or != b %}x{% endunless %}', token: '!=' },
      { source: '{% if a == b and > c %}x{% endif %}', token: '>' },
    ];

    for (const { source, token } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Conditional cannot start with '${token}'. Use a variable or value instead`,
      );
      expect(offenses[0].fix).to.equal(undefined);
    }
  });

  it('should report an offense for conditions starting with a logical operator', async () => {
    const testCases = [
      { source: '{% if and b %}x{% endif %}', token: 'and' },
      { source: '{% unless or b %}x{% endunless %}', token: 'or' },
    ];

    for (const { source, token } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Conditional cannot start with '${token}'. Use a variable or value instead`,
      );
      expect(offenses[0].fix).to.equal(undefined);
    }
  });

  it('should report an offense for comparisons missing their right-hand side', async () => {
    const testCases = [
      { source: '{% if var == %}x{% endif %}', operator: '==' },
      { source: '{% if a contains %}x{% endif %}', operator: 'contains' },
      { source: '{% if a == and b %}x{% endif %}', operator: '==' },
    ];

    for (const { source, operator } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Comparison operator '${operator}' is missing its right-hand side`,
      );
      expect(offenses[0].fix).to.equal(undefined);
    }
  });

  it('should report an offense for conditions ending with a logical operator', async () => {
    const testCases = [
      { source: '{% if a and %}x{% endif %}', operator: 'and' },
      { source: '{% if true and %}x{% endif %}', operator: 'and' },
      { source: '{% unless a or %}x{% endunless %}', operator: 'or' },
    ];

    for (const { source, operator } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Syntax is not supported: Conditional cannot end with '${operator}'. Expected a condition after it`,
      );
      expect(offenses[0].fix).to.equal(undefined);
    }
  });

  it('should report an offense for misspelled logical operators', async () => {
    const testCases = [
      {
        source: '{% if "wat" == "squat" adn "wat" == "squat" %}hello{% endif %}',
        misspelled: 'adn',
        expectedFix: '"wat" == "squat"',
      },
      {
        source: '{% if variable > 5 andd other < 10 %}hello{% endif %}',
        misspelled: 'andd',
        expectedFix: 'variable > 5',
      },
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase.source);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain('Anything after');

      const fixed = applyFix(testCase.source, offenses[0]);
      expect(fixed).to.contain(testCase.expectedFix);
    }
  });

  it('should report special message for JavaScript-style operators after literal values', async () => {
    const testCases = [
      '{% if true && false %}hello{% endif %}',
      '{% if false || true %}hello{% endif %}',
      '{% if "hello" && world %}hello{% endif %}',
      '{% if 42 || something %}hello{% endif %}',
    ];

    for (const source of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.contain(
        "Use 'and'/'or' instead of '&&'/'||' for multiple conditions",
      );
    }
  });

  it('should NOT report an offense for valid logical operators', async () => {
    const validCases = [
      '{% if price > 100 and discount < 50 %}hello{% endif %}',
      '{% if user.active or user.premium %}hello{% endif %}',
      '{% if x == 1 and y == 2 or z == 3 %}hello{% endif %}',
    ];

    for (const testCase of validCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses).to.have.length(0);
    }
  });
});
