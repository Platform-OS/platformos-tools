import { expect, describe, it } from 'vitest';
import { runLiquidCheck, applyFix } from '../../../test';
import { LiquidHTMLSyntaxError } from '..';

describe('Module: InvalidLoopIn', () => {
  it('should not report an offense for valid loops', async () => {
    // limit/offset/reversed cases live in the InvalidLoopArguments specs, which
    // provide the for-tag parameter docset this harness lacks
    const testCases = [
      '{% for x in arr %}a{% endfor %}',
      '{% for x in (1..5) %}a{% endfor %}',
      '{% tablerow x in arr %}a{% endtablerow %}',
    ];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses, `Failed for: ${testCase}`).to.have.length(0);
    }
  });

  it('should not report an offense for prefixes of valid loop markup still being typed', async () => {
    const testCases = ['{% for x %}a{% endfor %}', '{% for x in %}a{% endfor %}'];

    for (const testCase of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, testCase);
      expect(offenses, `Failed for: ${testCase}`).to.have.length(0);
    }
  });

  it('should report an offense and fix near-miss in keywords', async () => {
    const testCases = [
      {
        source: '{% for x inn arr %}a{% endfor %}',
        found: 'inn',
        fixed: '{% for x in arr %}a{% endfor %}',
      },
      {
        source: '{% for x IN arr %}a{% endfor %}',
        found: 'IN',
        fixed: '{% for x in arr %}a{% endfor %}',
      },
      {
        source: '{% tablerow x inn arr %}a{% endtablerow %}',
        found: 'inn',
        fixed: '{% tablerow x in arr %}a{% endtablerow %}',
      },
    ];

    for (const { source, found, fixed } of testCases) {
      const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);
      expect(offenses, `Failed for: ${source}`).to.have.length(1);
      expect(offenses[0].message).to.equal(
        `Expected 'in' after the loop variable, found '${found}'. Did you mean 'in'?`,
      );
      expect(applyFix(source, offenses[0])).to.equal(fixed);
    }
  });

  it('should report an offense without a fix when the in keyword is missing entirely', async () => {
    const source = '{% for x within arr %}a{% endfor %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(`Expected 'in' after the loop variable, found 'within'`);
    expect(offenses[0].fix).to.equal(undefined);
  });

  it('should report an offense inside liquid statement blocks', async () => {
    const source = '{% liquid\nfor x inn arr\n  echo x\nendfor %}';
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      `Expected 'in' after the loop variable, found 'inn'. Did you mean 'in'?`,
    );

    const fixed = applyFix(source, offenses[0]);
    expect(fixed).to.equal('{% liquid\nfor x in arr\n  echo x\nendfor %}');
  });
});
