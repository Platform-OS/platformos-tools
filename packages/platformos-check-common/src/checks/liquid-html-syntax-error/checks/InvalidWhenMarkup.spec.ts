import { expect, describe, it } from 'vitest';
import { runLiquidCheck, applyFix } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';

describe('Module: InvalidWhenMarkup', () => {
  it('should not report an offense for valid when values', async () => {
    const testCases = [
      '{% case x %}{% when 1 %}a{% endcase %}',
      "{% case x %}{% when 'str' %}a{% endcase %}",
      '{% case x %}{% when 1, 2 %}a{% endcase %}',
      '{% case x %}{% when 1 or 2 %}a{% endcase %}',
      "{% case x %}{% when 'a', 'b' or 'c' %}a{% endcase %}",
      '{% case x %}{% when var.lookup %}a{% endcase %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses, `Failed for: ${testCase}`).to.have.length(0);
    }
  });

  it('should report an offense for junk between when values', async () => {
    const source = '{% case x %}{% when 1 huh 2 %}a{% endcase %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: 'when' values are separated by ',' or 'or'. Anything after '1' will be ignored`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% case x %}{% when 1 %}a{% endcase %}');
  });

  it('should report an offense for junk after a valid value list', async () => {
    const source = "{% case x %}{% when 'a' or 'b' | upcase %}a{% endcase %}";
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: 'when' values are separated by ',' or 'or'. Anything after ''a' or 'b'' will be ignored`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal("{% case x %}{% when 'a' or 'b' %}a{% endcase %}");
  });

  it('should report an offense for a trailing separator', async () => {
    const source = '{% case x %}{% when 1, %}a{% endcase %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: 'when' values are separated by ',' or 'or'. Anything after '1' will be ignored`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% case x %}{% when 1 %}a{% endcase %}');
  });

  it('should report an offense inside liquid statement blocks', async () => {
    const source = '{% liquid\ncase x\nwhen 1 huh 2\n  echo "a"\nendcase %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Syntax is not supported: 'when' values are separated by ',' or 'or'. Anything after '1' will be ignored`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% liquid\ncase x\nwhen 1\n  echo "a"\nendcase %}');
  });
});
