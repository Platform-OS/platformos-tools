import { describe, expect, it } from 'vitest';

import { runLiquidCheck } from '../../../test';
import { LiquidHTMLSyntaxError } from '../index';

/**
 * A `hash_assign` target whose final subscript is dot access, or which has no
 * subscript at all.
 */
const messagesFor = async (source: string) =>
  (await runLiquidCheck(LiquidHTMLSyntaxError, source))
    .map((offense) => offense.message)
    .filter((message) => message.includes('hash_assign target must end in a bracket'));

/**
 * ONE message for both shapes the detector reports. The dot target and the bare target have the
 * same repair — each is valid under `{% assign %}` — so telling them apart would buy the author
 * nothing and cost a branch.
 */
const INVALID_TARGET =
  "A hash_assign target must end in a bracket subscript — hash_assign h['key'] = value. " +
  'platformOS raises Liquid::SyntaxError at parse time for any other form, so the file cannot ' +
  'be deployed or rendered. Rename the tag to {% assign %}, which accepts all of them.';

const HASH = `{% assign h = '{"a":{}}' | parse_json %}`;

/** Measured to RAISE `Liquid::SyntaxError` — the final subscript is a dot, or absent. */
const PLATFORM_REJECTS: Array<[label: string, target: string]> = [
  ['single dot', `h.k`],
  ['dot chain', `h.a.b`],
  ['bracket then dot', `h['a'].b`],
  ['double-quoted bracket then dot', `h["a"].b`],
  ['numeric bracket then dot', `h[0].b`],
  ['spaced dot', `h . k`],
  ['dot with question mark', `h.k?`],
  ['no subscript at all', `h`],
];

/** Measured to ASSIGN — the final subscript is a bracket. */
const PLATFORM_ACCEPTS: Array<[label: string, target: string]> = [
  ['single-quoted key', `h['k']`],
  ['double-quoted key', `h["k"]`],
  ['bracket chain', `h['a']['b']`],
  ['dot then bracket', `h.a['b']`],
  ['dot chain then bracket', `h.a.b['c']`],
  ['variable key', `h[k]`],
  ['numeric index', `h[0]`],
  ['non-identifier key', `h['k-1']`],
  ['space inside the brackets', `h[ 'k' ]`],
];

/**
 * NOT this detector's business, and NOT accepted by the platform either — recorded so the
 * distinction is not lost.
 */
const PLATFORM_REJECTS_BUT_NOT_FOR_NOTATION: Array<[label: string, target: string]> = [
  ['space before the brackets', `h [ 'k' ]`],
];

describe('detectInvalidHashAssignTargetSyntax', () => {
  it('reports every target the platform cannot parse', async () => {
    const reported = await Promise.all(
      PLATFORM_REJECTS.map(async ([label, target]) => [
        label,
        (await messagesFor(`${HASH}{% hash_assign ${target} = 1 %}`)).length,
      ]),
    );

    expect(Object.fromEntries(reported)).toEqual(
      Object.fromEntries(PLATFORM_REJECTS.map(([label]) => [label, 1])),
    );
  });

  it('stays SILENT on every target the platform accepts', async () => {
    // The control, and the reason this detector is positional rather than "no dots allowed".
    // `h.a['b']` and `h.a.b['c']` contain dots and assign perfectly well; a detector that
    // reported them would refuse working code on a check that BLOCKS.
    const reported = await Promise.all(
      PLATFORM_ACCEPTS.map(async ([label, target]) => [
        label,
        await messagesFor(`${HASH}{% hash_assign ${target} = 1 %}`),
      ]),
    );

    expect(Object.fromEntries(reported)).toEqual(
      Object.fromEntries(PLATFORM_ACCEPTS.map(([label]) => [label, []])),
    );
  });

  it('stays silent on a target the platform refuses for a reason that is not notation', async () => {
    // A KNOWN FALSE APPROVAL, asserted rather than left implicit. Silence here is right for
    // THIS detector — the target ends in a bracket, so its rule is satisfied — and wrong for
    // the toolchain, which reports nothing at all about a parse error that fails the whole
    // changeset. Pinning it means the gap is visible in the diff if someone "fixes" it here,
    // where the message would tell the author to change a `.` they did not write.
    const reported = await Promise.all(
      PLATFORM_REJECTS_BUT_NOT_FOR_NOTATION.map(async ([label, target]) => [
        label,
        await messagesFor(`${HASH}{% hash_assign ${target} = 1 %}`),
      ]),
    );

    expect(Object.fromEntries(reported)).toEqual({ 'space before the brackets': [] });
  });

  it('reports the whole offense, so the message and range are pinned', async () => {
    const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, `{% hash_assign h.k = 1 %}`);

    expect(offenses).toEqual([
      {
        check: 'LiquidHTMLSyntaxError',
        message: INVALID_TARGET,
        uri: 'file:///app/views/partials/file.liquid',
        severity: 0,
        type: 'LiquidHtml',
        // The TARGET is highlighted, not the whole tag: that is the part to change.
        start: { index: 15, line: 0, character: 15 },
        end: { index: 18, line: 0, character: 18 },
        // No autofix from THIS detector. Not because `h.a.b` is ambiguous — measured, it,
        // `h['a'].b` and `h['a']['b']` are the same nested write — but because `DeprecatedTag`
        // already rewrites the tag to `{% assign %}`, which takes this spelling as written.
        fix: undefined,
        suggest: undefined,
      },
    ]);
  });

  it('reports a bare target too, which no type check can catch', async () => {
    // `{% hash_assign h = 'V' %}` PARSES in this repository — `liquidTagHashAssignMarkup` is a
    // `liquidVariableLookup`, which matches a plain name — and raises on the platform whatever
    // the target holds. A FALSE APPROVAL until 2026-08-16: `h` is a HASH here, so
    // `InvalidWriteTarget` has nothing to say about it and this detector is the only thing
    // between the author and a file that cannot be parsed.
    expect([
      await messagesFor(`${HASH}{% hash_assign h = 1 %}`),
      await messagesFor(`${HASH}{% assign h = 1 %}`),
    ]).toEqual([[INVALID_TARGET], []]);
  });

  it('fires even when the container type is unknown, which is the whole point of the split', async () => {
    // `InvalidWriteTarget` answers a TYPE question and necessarily stays silent when it
    // cannot infer one — a render argument, a module value, a variable assigned in another
    // file. This defect does not depend on the type: the template cannot be parsed whatever
    // the variable holds. Put in that check, it would be silent exactly here.
    expect(await messagesFor(`{% hash_assign mystery.k = 1 %}`)).toEqual([
      expect.stringContaining('must end in a bracket subscript'),
    ]);
  });

  it('says nothing about hash_assign tags that are not about notation', async () => {
    // Guards against the detector firing on unrelated shapes. A `hash_assign` whose markup
    // failed to parse is `InvalidTagSyntax`'s to report, not this one's.
    const unrelated = [
      `${HASH}{% hash_assign h['k'] = 1 %}`,
      `{% assign x = 1 %}`,
      `{{ h.k }}`,
      `{% if h.k %}y{% endif %}`,
    ];

    const reported = await Promise.all(unrelated.map((source) => messagesFor(source)));

    expect(reported).toEqual(unrelated.map(() => []));
  });

  /**
   * The rule does NOT generalise to the other tags that write into a Hash, and the temptation
   * to generalise it is why this is pinned rather than left to the prose above.
   */
  describe('the dot rule belongs to hash_assign alone', () => {
    const DOT_TARGETS = [`h.k`, `h.a.b`, `h['a'].b`];

    it('says nothing about a dot target on the tags that accept one', async () => {
      const accepted = DOT_TARGETS.flatMap((target) => [
        `${HASH}{% assign ${target} = 1 %}`,
        `${HASH}{% function ${target} = 'lib/p' %}`,
      ]);

      const reported = await Promise.all(accepted.map((source) => messagesFor(source)));

      expect(reported).toEqual(accepted.map(() => []));
    });

    it('still reports the identical target under hash_assign', async () => {
      // The control, and it is the whole test. "Nothing was reported" is also what a detector
      // deleted outright produces, and these are the same three targets in the same buffer
      // shape — only the tag name differs.
      const rejected = DOT_TARGETS.map((target) => `${HASH}{% hash_assign ${target} = 1 %}`);

      const reported = await Promise.all(rejected.map((source) => messagesFor(source)));

      expect(reported).toEqual(
        rejected.map(() => [expect.stringContaining('must end in a bracket subscript')]),
      );
    });
  });
});
