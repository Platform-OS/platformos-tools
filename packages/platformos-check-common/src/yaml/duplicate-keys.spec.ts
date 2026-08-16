import { describe, expect, it } from 'vitest';

import { findDuplicateKeys } from './duplicate-keys';
import { PSYCH_KEY_IDENTITY } from './psych-key-identity';

/**
 * THE SOUNDNESS PROOF, over every pair of tokens Ruby was asked about.
 */

/** Tokens Ruby's safe loader refused to resolve — no identity to compare against. */
const RESOLVABLE = Object.entries(PSYCH_KEY_IDENTITY).filter(
  ([, identity]) => identity.group !== undefined,
);

/**
 * Whether Psych ends up with ONE key for these two tokens.
 */
const psychCollides = (a: string, b: string): boolean =>
  PSYCH_KEY_IDENTITY[a].group === PSYCH_KEY_IDENTITY[b].group;

/** Whether THIS implementation reports a duplicate for a two-key document. */
const weReport = (a: string, b: string): boolean =>
  findDuplicateKeys(`${a}: x\n${b}: y\n`).length > 0;

describe('Sweep: key identity against Ruby Psych', () => {
  it('never reports a collision the platform does not have', async () => {
    // SOUNDNESS. Every ordered pair, so an asymmetry in the implementation shows up too.
    // A failure here is a FALSE POSITIVE on legal YAML, which is the expensive direction
    // and the reason this sweep exists rather than a handful of examples.
    const falsePositives: string[] = [];

    for (const [a] of RESOLVABLE) {
      for (const [b] of RESOLVABLE) {
        // The DIAGONAL IS INCLUDED. `a === b` is a real document — the same key written
        // twice — and skipping it is what hid a missed detection in 11 tokens. It is also a
        // soundness case: a token must never be reported against itself unless Psych really
        // does collapse it, which for a repeatable merge key it does not.
        if (weReport(a, b) && !psychCollides(a, b)) {
          falsePositives.push(
            `${a} + ${b} — Psych: ${PSYCH_KEY_IDENTITY[a].klass}(${PSYCH_KEY_IDENTITY[a].value}) vs ` +
              `${PSYCH_KEY_IDENTITY[b].klass}(${PSYCH_KEY_IDENTITY[b].value})`,
          );
        }
      }
    }

    expect(falsePositives).toEqual([]);
  });

  it('reports the collisions it can, and the ones it skips are named', async () => {
    // COMPLETENESS, pinned rather than maximised. Silence is safe but it is not free, so
    // a shrinking detection rate has to be visible in a diff instead of arriving quietly.
    const missed: string[] = [];

    for (const [a] of RESOLVABLE) {
      for (const [b] of RESOLVABLE) {
        // `a > b` skips the mirror of each pair but KEEPS the diagonal. The previous `a >= b`
        // skipped `a === b` as well, which is how the pin below came to read as an exhaustive
        // bound while saying nothing about the most ordinary duplicate there is: one key
        // written twice. Eleven tokens were missed inside that blind spot.
        if (a > b) continue;
        if (psychCollides(a, b) && !weReport(a, b)) missed.push(`${a} + ${b}`);
      }
    }

    // FOUR pairs, across 5 476, and the number is stated because a narrower version of this
    // assertion skipped `a === b` — saying nothing about the most ordinary duplicate there is,
    // one key written twice. Eleven tokens were missed inside that blind spot.
    expect(missed.sort()).toEqual(['"0X10" + 0X10', '"1e3" + 1e3', '"y" + y', '1:30 + 5400']);
  });

  it('agrees with Psych that these DO collide', async () => {
    // The positive direction on the cases round 5 was about, asserted against the oracle
    // rather than against my reading of the YAML spec.
    expect(
      [
        ['yes', 'true'],
        ['on', 'true'],
        ['off', 'false'],
        ['014', '12'],
        ['0x10', '16'],
        ['+1', '1'],
        ['null', '~'],
        ['TRUE', 'true'],
      ].map(([a, b]) => [a, b, psychCollides(a, b), weReport(a, b)]),
    ).toEqual([
      ['yes', 'true', true, true],
      ['on', 'true', true, true],
      ['off', 'false', true, true],
      ['014', '12', true, true],
      ['0x10', '16', true, true],
      ['+1', '1', true, true],
      ['null', '~', true, true],
      ['TRUE', 'true', true, true],
    ]);
  });

  it('agrees with Psych that these do NOT collide', async () => {
    expect(
      [
        ['1', '1.0'],
        ['1', '"1"'],
        ['true', "'true'"],
        ['yes', '"yes"'],
        ['on', 'off'],
        ['null', '"null"'],
        // `nil` is not a YAML null in either parser — it is the string "nil".
        ['nil', 'null'],
      ].map(([a, b]) => [a, b, psychCollides(a, b), weReport(a, b)]),
    ).toEqual([
      ['1', '1.0', false, false],
      ['1', '"1"', false, false],
      ['true', "'true'", false, false],
      ['yes', '"yes"', false, false],
      ['on', 'off', false, false],
      ['null', '"null"', false, false],
      ['nil', 'null', false, false],
    ]);
  });

  it('covers the corpus it claims to, so the sweep cannot silently shrink', async () => {
    const total = Object.keys(PSYCH_KEY_IDENTITY).length;
    const refused = total - RESOLVABLE.length;

    // The DIAGONAL counts: `n * n`, not `n * (n - 1)`. The old formula excluded it, matching a
    // sweep that excluded it, so the two agreed with each other and neither described the real
    // coverage.
    expect({ total, refused, pairsSwept: RESOLVABLE.length * RESOLVABLE.length }).toEqual({
      total: 75,
      // Ruby's safe loader refuses to build a Date; that is a fact about the loader, not
      // about key identity, so timestamps are excluded rather than guessed at.
      refused: 1,
      pairsSwept: 5476,
    });
  });
});
