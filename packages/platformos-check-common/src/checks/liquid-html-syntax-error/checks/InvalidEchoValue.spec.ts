import { expect, describe, it, vi, beforeEach } from 'vitest';
import { applyFix, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

describe('detectInvalidEchoValue', async () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not report when echo value is valid', async () => {
    const testCases = [
      `{% echo '123' %}`,
      `{% echo '123' | upcase %}`,
      `{{ '123' }}`,
      `{{ '123' | upcase }}`,
      `{{ }}`,
      `{{ echo }}`,
      `{% liquid echo %}`,
    ];

    for (const sourceCode of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).to.have.length(0);
    }
  });

  it('should not report when there are no filters provided', async () => {
    const sourceCode = `{% echo '123' %}`;
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(0);
  });

  it('should report when there are multiple values (no filters)', async () => {
    const testCases = [
      [`{% echo '123' 555 text %}`, "{% echo '123' %}"],
      [`{% echo "123" 555 text %}`, '{% echo "123" %}'],
      [`{% echo 123 555 text %}`, '{% echo 123 %}'],
      [`{% echo true 555 text %}`, '{% echo true %}'],
      [`{{ '123' 555 text }}`, `{{ '123' }}`],
      [`{{ "123" 555 text }}`, `{{ "123" }}`],
      [`{{ 123 555 text }}`, `{{ 123 }}`],
      [`{{ true 555 text }}`, `{{ true }}`],
    ];

    for (const [sourceCode, expected] of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.equal('Syntax is not supported');

      const fixed = applyFix(sourceCode, offenses[0]);
      expect(fixed).to.equal(expected);
    }
  });

  it('should report when there are multiple values (with filters)', async () => {
    const testCases = [
      [`{% echo '123' 555 text | upcase %}`, "{% echo '123' | upcase %}"],
      [`{% echo "123" 555 text | upcase %}`, '{% echo "123" | upcase %}'],
      [`{% echo 123 555 text | default: 0 %}`, '{% echo 123 | default: 0 %}'],
      [`{% echo true 555 text | fake-filter: 'yes' %}`, "{% echo true | fake-filter: 'yes' %}"],
      [`{{ '123' 555 text | upcase }}`, `{{ '123' | upcase }}`],
      [`{{ "123" 555 text | default: 0 }}`, `{{ "123" | default: 0 }}`],
      [`{{ 123 555 text | fake-filter: 'yes' }}`, `{{ 123 | fake-filter: 'yes' }}`],
      [`{{ true 555 text | fake-filter: 'yes' }}`, `{{ true | fake-filter: 'yes' }}`],
    ];

    for (const [sourceCode, expected] of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.equal('Syntax is not supported');

      const fixed = applyFix(sourceCode, offenses[0]);
      expect(fixed).to.equal(expected);
    }
  });

  it('should report when there are multiple instances of the error', async () => {
    const sourceCode = `{% echo zero %} {% echo one two %} {% echo one two %}`;

    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
    expect(offenses).to.have.length(2);
    expect(offenses[0].message).to.equal('Syntax is not supported');
    expect(offenses[1].message).to.equal('Syntax is not supported');

    const fixed = applyFix(sourceCode, offenses[0]);
    expect(fixed).to.equal(`{% echo zero %} {% echo one %} {% echo one two %}`);

    const fixed2 = applyFix(sourceCode, offenses[1]);
    expect(fixed2).to.equal(`{% echo zero %} {% echo one two %} {% echo one %}`);
  });

  it('should not report an array literal as the piped value', async () => {
    // Regression: the grammar rejected an array literal in this position, so the markup degraded
    // to a raw string and this check reported "Syntax is not supported" on code that renders —
    // a false positive in a blocking check. Every case below was measured on a live instance:
    // `{{ [1,2] | size }}` renders 2, and `{{ ["x"] | size }}` renders 1.
    const testCases = [
      `{{ [1,2] | size }}`,
      `{{ [1,2] }}`,
      `{{ [] }}`,
      `{{ ["x"] | size }}`,
      `{{ [ "a" , "b" ] | join: "-" }}`,
      `{{ [[1,2],[3]] | size }}`,
      `{{ [1,2] | size | plus: 10 }}`,
      `{% echo [1,2] | size %}`,
      `{% print [1,2] | size %}`,
      `{% liquid echo [1,2] | size %}`,
    ];

    for (const sourceCode of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses, sourceCode).toEqual([]);
    }
  });

  it('should still report an unsupported drop after accepting array literals', async () => {
    // The CONTROL for the silence above: a suppression wide enough to hide a real defect would
    // pass every "nothing was reported" assertion in the previous test. These are still reported,
    // so the array literal is accepted because the grammar now parses it — not because this check
    // stopped looking at drops and echoes.
    const testCases = [`{{ 123 555 text }}`, `{% echo '123' 555 text %}`, `{{ | upcase }}`];

    for (const sourceCode of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(
        offenses.map((offense) => offense.message),
        sourceCode,
      ).toEqual(['Syntax is not supported']);
    }
  });

  it('should report when there is no value', async () => {
    const testCases = [
      [`{% echo | upcase %}`, '{% echo blank %}'],
      [`{{ | upcase }}`, `{{ blank }}`],
      [`{% liquid echo | upcase %}`, `{% liquid echo blank %}`],
    ];

    for (const [sourceCode, expected] of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).to.equal('Syntax is not supported');

      const fixed = applyFix(sourceCode, offenses[0]);
      expect(fixed).to.equal(expected);
    }
  });
});
