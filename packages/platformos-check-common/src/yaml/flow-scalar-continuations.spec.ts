import { describe, expect, it } from 'vitest';

import { toYAMLNode } from './parse';
import { findDuplicateKeys } from './duplicate-keys';

/**
 * TASK-50. A quoted scalar continued at or below its key's indentation.
 *
 * THE MISMATCH. npm `yaml` implements YAML 1.2, which requires a flow scalar's continuation
 * to be indented MORE than its parent. Psych/libyaml accepts equal or lesser indentation,
 * including column 0. So the ordinary thing a translator does was a `YAMLSyntaxError` — which
 * BLOCKS — on a file the converter accepts and Psych reads as a plain string.
 *
 * WHY THE OBVIOUS FIXES ARE DEAD, all measured rather than reasoned about:
 *
 *   an option           neither `version: '1.1'` nor `strict: false` changes it, alone or
 *                       together. TASK-43 found the same for line breaks; this is a different
 *                       mechanism and was measured separately.
 *   filtering the code  `MISSING_CHAR` is reported for this AND for a genuinely unterminated
 *                       quote, an unquoted multi-line value, and bad block indentation. Not
 *                       diagnostic, so suppressing it would buy false approvals.
 *   the library's CST   its `Lexer` has already decided the wrong way — it emits `"Hello` as a
 *                       complete scalar token — so there is nothing there to reuse.
 *   re-indenting        would fix the parse and shift every offset after the first
 *                       continuation, so diagnostics would point at the wrong characters.
 *
 * WHAT IS DONE INSTEAD. The parser's own error positions drive a ONE-BYTE-FOR-ONE-BYTE
 * substitution — the line break becomes a space — and the result is accepted only if it then
 * parses cleanly. Soundness is therefore structural rather than heuristic: the question is
 * never "does this look like the 1.1 shape" but "is the platform's reading of these bytes a
 * valid document".
 */
describe('Module: flow scalar continuations', () => {
  /** The value of `k` under `en`, or undefined. */
  const valueOfK = (source: string): unknown => {
    const root = toYAMLNode(source) as any;
    const inner = root.children?.[0]?.value;
    return inner?.children?.find((child: any) => child.key?.value === 'k')?.value?.value;
  };

  const parses = (source: string): boolean => {
    try {
      toYAMLNode(source);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * The indentation ladder, which is the whole discriminator (AC#7).
   *
   * Only the relationship between the continuation's indent and the key's decides it, so all
   * four rungs are pinned rather than just the reported one.
   */
  describe('the indentation ladder', () => {
    const LADDER: Array<[label: string, source: string]> = [
      [
        'deeper than the key',
        `en:
  k: "Hello
    world"
`,
      ],
      [
        'aligned with the key',
        `en:
  k: "Hello
  world"
`,
      ],
      [
        'shallower than the key',
        `en:
  k: "Hello
 world"
`,
      ],
      [
        'at column 0',
        `en:
  k: "Hello
world"
`,
      ],
    ];

    for (const [label, source] of LADDER) {
      it(`parses when the continuation is ${label}`, async () => {
        expect(parses(source)).toBe(true);
      });

      it(`folds to the platform's value when the continuation is ${label}`, async () => {
        // Psych folds a multi-line flow scalar's break to a single space and drops the
        // continuation's leading whitespace. Verified against Ruby directly, which is why the
        // value is asserted and not merely the absence of an error: the byte-for-byte
        // substitution alone leaves `"Hello   world"`, and shipping that would put a value in
        // the AST that the platform does not have.
        expect(valueOfK(source)).toEqual('Hello world');
      });
    }

    it('folds a three-line scalar, and both quote styles', async () => {
      expect(
        valueOfK(`en:
  k: "a
  b
  c"
`),
      ).toEqual('a b c');
      expect(
        valueOfK(`en:
  k: 'Hello
  world'
`),
      ).toEqual('Hello world');
      // ESCAPED, unlike its two neighbours: the two spaces before the line break are
      // what this row is about, and a template literal would park them at the end of a
      // source line for the next whitespace trim to delete.
      expect(valueOfK('en:\n  k: "trailing  \n  x"\n')).toEqual('trailing x');
    });
  });

  /**
   * The control group, and the reason this fix is not a suppression.
   *
   * Every one of these is rejected by Psych too, so a fix that swallowed them would trade one
   * false block for several false approvals — on a check that BLOCKS, which is the most
   * expensive direction available.
   */
  describe('genuinely invalid YAML still fails', () => {
    const STILL_INVALID: Array<[label: string, source: string]> = [
      [
        'an unterminated quote',
        `en:
  k: "Hello
`,
      ],
      [
        'an unterminated quote at end of input',
        `en:
  k: "Hello`,
      ],
      [
        'an unquoted multi-line value',
        `en:
  k: Hello
  world
`,
      ],
      ['tab indentation', 'en:\n\tk: 1\n'],
      [
        'an unclosed flow sequence',
        `en:
  k: [1, 2
`,
      ],
      [
        'a compact nested mapping',
        `a: 1
b: 2
  c: 3
`,
      ],
      [
        'a sequence item without an indicator',
        `en:
 - a: 1
   b: 2
  c: 3
`,
      ],
    ];

    for (const [label, source] of STILL_INVALID) {
      it(`still reports ${label}`, async () => {
        expect(parses(source)).toBe(false);
      });
    }

    it('still reports a real error that sits ALONGSIDE a valid continuation', async () => {
      // The soundness proof. Reconciliation tolerates a mixed error set while it works, so
      // this is the case that shows acceptance is decided by the FINAL parse being clean and
      // not by any intermediate state. Without that, a file could be rescued into silence
      // while still carrying a tab-indent error.
      expect(parses('en:\n  k: "Hello\n  world"\n\tj: 2\n')).toBe(false);
    });
  });

  describe('the rest of the document is still analysed', () => {
    it('keeps later keys, and more than one multi-line scalar', async () => {
      const root = toYAMLNode(`en:
  a: "1
  2"
  b: "3
  4"
  c: 5
`) as any;
      const inner = root.children[0].value;
      const byKey = Object.fromEntries(
        inner.children.map((child: any) => [child.key.value, child.value.value]),
      );

      expect(byKey).toEqual({ a: '1 2', b: '3 4', c: 5 });
    });

    it('finds a duplicate key in a reconciled file, at the right offset', async () => {
      // The gap this closes, and it was NOT obvious: `findDuplicateKeys` parses separately
      // from `toYAMLNode` because it needs 1.1 scalar resolution for key identity, so fixing
      // the false block alone left it silently blind to every file with this shape.
      //
      // The offset assertion is the point. Because the substitution is byte-for-byte, the
      // duplicate's range is still an offset into the ORIGINAL source — the two scalar lines
      // above it shift the reported position by exactly two lines and nothing else.
      const source = `en:
  k: "Hello
  world"
  dup: 1
  dup: 2
`;
      const withoutScalar = `en:
  dup: 1
  dup: 2
`;

      const found = findDuplicateKeys(source);
      const control = findDuplicateKeys(withoutScalar);

      expect(found.map((duplicate) => duplicate.key)).toEqual(['dup']);
      expect(control.map((duplicate) => duplicate.key)).toEqual(['dup']);
      // `  dup: 1` is the discarded entry in both, and the source text at that offset proves
      // the offset is right without depending on how lines are counted.
      expect(source.slice(found[0].discardedStart, found[0].discardedEnd)).toEqual('dup: 1');
      expect(withoutScalar.slice(control[0].discardedStart, control[0].discardedEnd)).toEqual(
        'dup: 1',
      );
    });
  });

  it('leaves a document that parses normally completely alone', async () => {
    // The reconciliation must never run on a healthy file, both for cost and because a
    // needless second parse is a needless second opinion. Asserted by value equality across
    // shapes that have nothing to reconcile.
    const root = toYAMLNode(`en:
  k: "Hello world"
  n: 1
  t: true
`) as any;
    const inner = root.children[0].value;

    expect(
      Object.fromEntries(inner.children.map((c: any) => [c.key.value, c.value.value])),
    ).toEqual({ k: 'Hello world', n: 1, t: true });
  });
});
