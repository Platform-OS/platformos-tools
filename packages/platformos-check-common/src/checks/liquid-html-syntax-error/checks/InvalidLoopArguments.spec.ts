import { expect, describe, it } from 'vitest';
import { applyFix, messagesOf, runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

/**
 * AGAINST THE SHIPPED `tags.json`, which is what a user's editor answers from.
 *
 * The declared docset below publishes `positional` on every tag parameter. The real one publishes
 * it on none — and requiring `parameter.positional === false` therefore matched nothing, so every
 * loop argument in the language was reported as unknown, with an autofix that deleted it. The
 * declared docset could not show that, because the field it hinges on is one it invents.
 */
describe('detectInvalidLoopArguments, against the published documents', () => {
  const check = (sourceCode: string) => runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

  it('accepts every loop argument the docset publishes', async () => {
    expect({
      namedNumber: messagesOf(await check(`{% for i in array limit: 2 %}{% endfor %}`)),
      namedTwice: messagesOf(await check(`{% for i in array limit: 2 offset: 1 %}{% endfor %}`)),
      positional: messagesOf(await check(`{% for i in array reversed %}{% endfor %}`)),
      tablerow: messagesOf(
        await check(`{% tablerow x in array cols: 2 limit: 10 %}{% endtablerow %}`),
      ),
    }).toEqual({ namedNumber: [], namedTwice: [], positional: [], tablerow: [] });
  });

  it('CONTROL: still reports an argument the docset does not publish', async () => {
    // Without this, the silence above is satisfied by a check that reports nothing at all.
    expect(messagesOf(await check(`{% for i in array bogus: 2 %}{% endfor %}`))).toEqual([
      'Arguments must be provided in the format `for in <array> <positional arguments> <named arguments>`. Invalid/Unknown arguments: bogus: 2',
    ]);
  });
});

describe('detectInvalidLoopArguments', async () => {
  it('should not report when args are valid', async () => {
    const testCases = [
      `{% for i in array reversed %}{% endfor %}`,
      `{% for i in array reversed offset: 1 %}{% endfor %}`,
      `{% tablerow x in array limit: 10 %}{% endtablerow %}`,
      `{% tablerow x in array cols: 2 limit: 10 %}{% endtablerow %}`,
    ];

    for (const sourceCode of testCases) {
      const offenses = await testCheck(sourceCode);
      expect(offenses).to.have.length(0);
    }
  });

  it('should report when invalid args are found', async () => {
    const testCases = [
      [
        `{% for i in array limit1: 10 %}{% endfor %}`,
        '{% for i in array  %}{% endfor %}',
        'limit1: 10',
      ],
      [
        `{% for i in array !! range: (1..2) %}{% endfor %}`,
        '{% for i in array  %}{% endfor %}',
        '!!, range: (1..2)',
      ],
      [
        `{% tablerow i in (1..10) limit1: 10 %}{{ i }}{% endtablerow %}`,
        '{% tablerow i in (1..10)  %}{{ i }}{% endtablerow %}',
        'limit1: 10',
      ],
    ];

    for (const [sourceCode, expected, invalidArguments] of testCases) {
      const offenses = await testCheck(sourceCode);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).toEqual(
        expect.stringContaining(`Invalid/Unknown arguments: ${invalidArguments}`),
      );

      const fixed = applyFix(sourceCode, offenses[0]);
      expect(fixed).to.equal(expected);
    }
  });

  it('should report when positional args are found after named/invalid args', async () => {
    const testCases = [
      [
        `{% for i in array limit: 10 reversed %}{% endfor %}`,
        '{% for i in array limit: 10 %}{% endfor %}',
        'reversed',
      ],
      [
        `{% for i in array reversed limit: 10 invalid %}{% endfor %}`,
        '{% for i in array reversed limit: 10 %}{% endfor %}',
        'invalid',
      ],
      [
        `{% for i in array !! reversed limit: 10 invalid %}{% endfor %}`,
        '{% for i in array limit: 10 %}{% endfor %}',
        '!!, reversed, invalid',
      ],
      [
        `{% for i in array reversed: (1..2) %}{% endfor %}`,
        '{% for i in array  %}{% endfor %}',
        'reversed: (1..2)',
      ],
    ];

    for (const [sourceCode, expected, invalidArguments] of testCases) {
      const offenses = await testCheck(sourceCode);
      expect(offenses).to.have.length(1);
      expect(offenses[0].message).toEqual(
        expect.stringContaining(`Invalid/Unknown arguments: ${invalidArguments}`),
      );

      const fixed = applyFix(sourceCode, offenses[0]);
      expect(fixed).to.equal(expected);
    }
  });

  it('should report when there are multiple instances of the error', async () => {
    const sourceCode = `{% for i in array reversed limit: 10 invalid %}{% endfor %} {% tablerow x in array cols: 2 limit: 10 invalid %}{% endtablerow %}`;

    const offenses = await testCheck(sourceCode);
    expect(offenses).to.have.length(2);
    for (const offense of offenses) {
      expect(offense.message).toEqual(
        expect.stringContaining(`Invalid/Unknown arguments: invalid`),
      );
    }

    const fixed = applyFix(sourceCode, offenses[0]);
    expect(fixed).to.equal(
      '{% for i in array reversed limit: 10 %}{% endfor %} {% tablerow x in array cols: 2 limit: 10 invalid %}{% endtablerow %}',
    );

    const fixed2 = applyFix(sourceCode, offenses[1]);
    expect(fixed2).to.equal(
      '{% for i in array reversed limit: 10 invalid %}{% endfor %} {% tablerow x in array cols: 2 limit: 10 %}{% endtablerow %}',
    );
  });
});

/**
 * A DECLARED docset, for the branch the published one cannot reach: a tag parameter that says
 * whether it is written by position. No shipped tag parameter carries `positional`, so the strict
 * arm — `reversed: (1..2)` is wrong because `reversed` is positional — is unreachable with the real
 * file and is exercised here instead. The tolerant arm, which is what every user gets, is measured
 * against the shipped documents at the top of this file.
 */
function testCheck(sourceCode: string) {
  return runLiquidCheck(LiquidHTMLSyntaxError, sourceCode, undefined, {
    platformosDocset: {
      graphQL: async () => null,
      tags: () =>
        Promise.resolve([
          {
            name: 'for',
            parameters: [
              {
                name: 'reversed',
                positional: true,
                description: '...',
                required: false,
                types: [],
              },
              { name: 'limit', positional: false, description: '...', required: false, types: [] },
              { name: 'offset', positional: false, description: '...', required: false, types: [] },
            ],
          },
          {
            name: 'tablerow',
            parameters: [
              { name: 'cols', positional: false, description: '...', required: false, types: [] },
              { name: 'limit', positional: false, description: '...', required: false, types: [] },
              { name: 'offset', positional: false, description: '...', required: false, types: [] },
            ],
          },
        ]),
      filters: () => Promise.resolve([]),
      objects: () => Promise.resolve([]),
      liquidDrops: () => Promise.resolve([]),
      liquidDoc: () => Promise.resolve({ annotations: [], param_types: [] }),
    },
  });
}
