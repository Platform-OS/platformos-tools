import { describe, expect, it } from 'vitest';

import { TruncatedLiquidBlock } from './index';
import { allChecks } from '../index';
import { Severity } from '../../types';
import { check, highlightedOffenses, runLiquidCheck } from '../../test';

/**
 * Every fixture below was rendered on a live instance through `/api/app_builder/liquid_exec`,
 * and the RENDERED OUTPUT is what decides which list it belongs to — not a reading of the
 * grammar. A truncated block does not raise; it returns 200 with the block's own source in the
 * body, so "it looks wrong" is not available as evidence and the output is the only oracle.
 *
 *   TRUNCATES                                        RENDERS CORRECTLY
 *   {% liquid                                        {% liquid
 *     # a comment mentioning %} the rest               # a comment mentioning the rest
 *     assign d = 21 | times: 2                         assign d = 21 | times: 2
 *   %}R=[{{ d }}]                                    %}R=[{{ d }}]
 *   -> " the rest\n  assign d = …\n%}R=[]"           -> "R=[42]"
 *
 * The check is deliberately NOT a comment rule — see the string case below, which involves no
 * comment at all and which the originating bug report's proposed rule would have missed.
 */
const PAGE = 'app/views/pages/index.liquid';

const messages = async (source: string) =>
  (await runLiquidCheck(TruncatedLiquidBlock, source, PAGE)).map((offense) => offense.message);

/**
 * The one message this check produces, spelled as the check spells it.
 *
 * Both repairs it names were MEASURED, because a remedy that does not work is worse than none:
 * `assign s = "a %" | append: "} b"` renders `a %} b`, and a comment moved into
 * `{% comment %}…{% endcomment %}` renders. There is deliberately no autofix — see the check.
 */
const TRUNCATED =
  'This {% liquid %} block ends EARLY, at a %} inside one of its own statements — a comment or ' +
  'a string — so the statements after that point never run and are rendered to the page as ' +
  'text. Nothing raises: the platform ends the block at the first %} it finds, wherever it ' +
  'appears. To keep the sequence in a string, build it — assign s = "a %" | append: "} b". To ' +
  'keep it in a comment, move the comment out of the block into ' +
  '{% comment %}...{% endcomment %}, which is unaffected.';

describe('Module: TruncatedLiquidBlock — the shapes that truncate', () => {
  /** Measured to TRUNCATE: the rendered output contained the block's own source. */
  const TRUNCATES: Array<[label: string, source: string]> = [
    [
      'a %} inside a leading comment',
      `{% liquid
  # a comment mentioning %} the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
    [
      'a %} inside a TRAILING comment',
      `{% liquid
  assign d = 21 | times: 2
  # trailing %} comment
%}R=[{{ d }}]`,
    ],
    [
      'a %} inside a double-quoted string, with no comment anywhere',
      `{% liquid
  assign s = "a %} b"
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
    [
      'a %} inside a single-quoted string',
      `{% liquid
  assign s = 'a %} b'
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
    [
      'the damaging variant: the truncation swallows a function return',
      `{% liquid
  # note: this mentions %} the closing sequence
  assign d = 21 | times: 2
  return d
%}`,
    ],
    [
      'a whitespace-trimmed opening delimiter',
      `{%- liquid
  # a comment mentioning %} the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
    [
      'stray text containing another Liquid construct before the stranded delimiter',
      `{% liquid
  # a comment mentioning %} {{ x }} the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
  ];

  for (const [label, source] of TRUNCATES) {
    it(`reports ${label}`, async () => {
      expect(await messages(source)).toEqual([TRUNCATED]);
    });
  }

  it('highlights the whole {% liquid %} tag, which is the construct at fault', async () => {
    // The offense must name the BLOCK, not the stranded `%}` and not the statement that
    // follows. This defect's main cost is that every existing signal points somewhere else:
    // the runtime raises "function must return a value" against a correct `return`, and the
    // linter's incidental `UndefinedObject` points at the variable rather than the cause.
    const source = `{% liquid
  # a comment mentioning %} the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`;

    expect(
      highlightedOffenses(
        { [PAGE]: source },
        await runLiquidCheck(TruncatedLiquidBlock, source, PAGE),
      ),
    ).toEqual([`{% liquid\n  # a comment mentioning %}`]);
  });
});

describe('Module: TruncatedLiquidBlock — the shapes that are fine', () => {
  /**
   * Measured to RENDER CORRECTLY — the response held the expected output and none of the
   * block's own source. Each one is a near-miss of a fixture above, so a rule that over-fires
   * shows up here rather than in a corpus scan months later.
   */
  const RENDERS: Array<[label: string, source: string]> = [
    [
      'the same block without the %} in its comment',
      `{% liquid
  # a comment mentioning the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`,
    ],
    [
      'a trailing comment on its own line, which is the commonest valid shape',
      `{% liquid
  assign x = 1
  # done
%}OK`,
    ],
    ['a one-line block', `{% liquid assign a = 1 %}OK`],
    [
      'a markup-less tag closing the block, whose empty markup is not a parse failure',
      `{% liquid
  assign a = 1
  break
%}OK`,
    ],
    ['a one-line block ending in a markup-less tag', `{% liquid break %}OK`],
    ['a # inside a string, which is not a comment', `{% liquid assign a = "a # b" %}OK`],
    [
      'a whitespace-trimmed closing delimiter',
      `{% liquid
  assign a = 1
-%}OK`,
    ],
    [
      'a %} inside a raw block, which is body text and not a delimiter',
      `{% liquid assign a = 1 %}{% raw %}{% x %} and %} {% endraw %}`,
    ],
    [
      'a comment-only block, which swallows its delimiter but loses nothing',
      `{% liquid # just a note %}OK`,
    ],
    // The three below exist because SABOTAGE proved the rest of this list could not see the
    // rules they cover. Each earlier fixture failed to exercise its rule: the conjunction's
    // OTHER half was silencing the check, so breaking the rule under test changed nothing and
    // the suite stayed green. A fixture has to make one half true for the other half to be
    // observable.
    [
      // Breaks when the same-line requirement is dropped. Measured: "OK[1] write %} to close a
      // tag" — a valid block followed by prose that mentions the delimiter, which is the one
      // false positive a stranded-delimiter rule would produce on its own.
      'a valid block followed by prose that contains %}',
      `{% liquid
  assign x = 1
  # done
%}OK[{{ x }}] write %} to close a tag`,
    ],
    [
      // Breaks when empty markup is treated as a parse failure. `break` and `continue` carry
      // `''`, which is absence of markup, not markup that failed to parse. Measured: renders
      // without leaking the block's source. (The body is empty because a top-level `break`
      // stops output — that is `break` semantics, not truncation.)
      'a markup-less tag closing a one-line block, with a stray %} later in the file',
      `{% liquid break %}OK write %} here`,
    ],
    [
      // Breaks when the stranded-delimiter scan stops skipping whole Liquid constructs: a naive
      // scan reads the `%}` of `{% if true %}` as stranded. Measured: renders "Y".
      'a comment-only block followed by well-formed tags whose own delimiters must not count',
      `{% liquid # just a note %}{% if true %}Y{% endif %}`,
    ],
  ];

  for (const [label, source] of RENDERS) {
    it(`stays silent on ${label}`, async () => {
      expect(await messages(source)).toEqual([]);
    });
  }

  /**
   * Measured to FAIL — but not with this defect, and not as this check's business.
   *
   * Kept apart from {@link RENDERS} because lumping them together would put a false claim in
   * the fixture list: neither of these renders. The reason each must stay silent HERE is
   * ownership, not validity, and a check that reported them would give the wrong diagnosis —
   * which is the exact failure this check exists to stop doing.
   */
  const OWNED_ELSEWHERE: Array<[label: string, source: string, why: string]> = [
    [
      'a malformed statement that did NOT eat the delimiter',
      `{% liquid
  assign = = =
%}OK`,
      // Measured: raises `Syntax Error in 'assign'`. `LiquidHTMLSyntaxError` reports it with
      // the correct message, and the delimiter is intact, so nothing was truncated.
      'LiquidHTMLSyntaxError owns it',
    ],
    [
      'a %} inside an output, which the platform cannot parse either',
      `{% liquid assign a = 1 %}{{ '%}' }}`,
      // Measured: raises `Variable '{{ '%}' was not properly terminated`. The `{{ }}` lexer has
      // the same blindness as the `{% liquid %}` one. Our parser ACCEPTS it and nothing reports
      // it, so it is a separate false approval, tracked on its own. It is not a truncated
      // block, and this check must not claim it.
      'a separate, still-unreported defect in the output lexer',
    ],
  ];

  for (const [label, source, why] of OWNED_ELSEWHERE) {
    it(`stays silent on ${label} — ${why}`, async () => {
      expect(await messages(source)).toEqual([]);
    });
  }

  it('is silent because of the CODE, not because the fixtures are inert', async () => {
    // The control that keeps the block above honest. Every entry in RENDERS asserts an empty
    // array, which a check that had stopped working entirely would satisfy just as well. This
    // runs the same helper over a fixture that must fire, so the two halves cannot both be
    // vacuous.
    const truncated = `{% liquid
  # a comment mentioning %} the closing sequence
  assign d = 21 | times: 2
%}R=[{{ d }}]`;

    expect(await messages(truncated)).toEqual([TRUNCATED]);
  });
});

describe('Module: TruncatedLiquidBlock — the whole toolchain', () => {
  it('reports through the full check pipeline, not only through this check alone', async () => {
    // `runLiquidCheck` runs one check in isolation. Registration in `allChecks` is what puts it
    // in front of the CLI, the language server and the supervisor, and it is a separate fact:
    // a check can be written, correct, and never reach a caller. Asserting the whole offense
    // pins the code and the severity that the write gate reads.
    const offenses = await check(
      {
        [PAGE]: `{% liquid
  # a comment mentioning %} the closing sequence
  assign d = 21 | times: 2
%}`,
      },
      allChecks,
    );

    expect(
      offenses.map((offense) => ({ check: offense.check, severity: offense.severity })),
    ).toEqual([{ check: 'TruncatedLiquidBlock', severity: 0 }]);
  });

  it('is registered as recommended, so a default project gets it', async () => {
    // Enabled-by-default is the difference between a check that protects everyone and one that
    // protects whoever edits their config. `recommended` is derived from `meta.docs.recommended`
    // plus the targets list, so this pins both.
    const { recommended } = await import('../index');

    expect(recommended.map((definition) => definition.meta.code)).toContain('TruncatedLiquidBlock');
  });

  /**
   * FALSE POSITIVES, MEASURED RATHER THAN ASSERTED.
   *
   * The detector was run over every `.liquid` file in seven real projects — 7250 files holding
   * 6274 `{% liquid %}` blocks, including two marketplaces of ~2300 files each — and fired
   * ZERO times. That is the number this check's severity rests on: it reports at `error`, and
   * an error nobody can act on is the expensive kind.
   *
   * The corpus is not committed here (it is other people's code and far too large), so this is
   * recorded rather than executed. What IS executed is the near-miss list above, which is the
   * part a future edit can actually break — a corpus scan proves the check is quiet on code
   * nobody wrote this construct in, and says nothing about the boundary.
   */
  it('reports at ERROR, which is half of what the write gate requires', async () => {
    // `blocksWrite` needs severity `error` AND membership of the supervisor's
    // `BLOCKING_CHECKS`. The two halves live in different packages on purpose, so neither can
    // gate a write on its own. This pins the half that belongs here; the membership half, and
    // the end-to-end proof that a truncated block actually stops the write, live in the
    // supervisor's `blocking-emission.spec.ts` and `blocking.spec.ts`.
    //
    // The platform renders a truncated block with HTTP 200, so this is one of the few members
    // admitted on consequence rather than on a converter rejection — the author's statements
    // never run and the block's source is emitted to the client, which is harder to diagnose
    // than an error. A downgrade here would silently un-gate it, hence the exact assertion.
    const offenses = await runLiquidCheck(
      TruncatedLiquidBlock,
      `{% liquid
  # a comment mentioning %} the closing sequence
  assign d = 21
%}`,
      PAGE,
    );

    expect(
      offenses.map((offense) => ({ check: offense.check, severity: offense.severity })),
    ).toEqual([{ check: 'TruncatedLiquidBlock', severity: Severity.ERROR }]);
  });
});
