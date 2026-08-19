import { describe, expect, it } from 'vitest';

import { findNearestKeys, levenshtein } from './levenshtein';

/**
 * The matrix implementation, kept as an ORACLE: the risk in the two-row version is entirely
 * in the row bookkeeping — which row is "the row above" after the swap, what an empty input
 * leaves behind — which a differential catches and a hand-written table of distances does not.
 */
function referenceLevenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

describe('Function: levenshtein', () => {
  it('should measure the documented distances', () => {
    expect([
      levenshtein('', ''),
      levenshtein('', 'abc'),
      levenshtein('abc', ''),
      levenshtein('abc', 'abc'),
      levenshtein('kitten', 'sitting'),
      levenshtein('flaw', 'lawn'),
      levenshtein('a', 'b'),
      levenshtein('app.title', 'app.titel'),
    ]).toEqual([0, 3, 3, 0, 3, 2, 1, 2]);
  });

  it('should be symmetric', () => {
    expect([levenshtein('kitten', 'sitting'), levenshtein('sitting', 'kitten')]).toEqual([3, 3]);
  });

  // Empty strings on either side, one-character strings, a common prefix, a common suffix,
  // equal lengths with a substitution, and lengths differing by more than one.
  it('should agree with the matrix implementation on every pair of a spanning set', () => {
    const words = [
      '',
      'a',
      'b',
      'ab',
      'ba',
      'abc',
      'abcd',
      'axc',
      'abcx',
      'xabc',
      'app.title',
      'app.titel',
      'app.user.name',
      'user.name',
      'completely.different.key',
    ];

    const disagreements = words.flatMap((a) =>
      words
        .map((b) => ({ a, b, got: levenshtein(a, b), want: referenceLevenshtein(a, b) }))
        .filter(({ got, want }) => got !== want),
    );

    expect(disagreements).toEqual([]);
  });
});

describe('Function: findNearestKeys', () => {
  const keys = ['app.title', 'app.subtitle', 'app.user.name', 'checkout.total'];

  it('should return the nearest keys, closest first', () => {
    expect(findNearestKeys('app.titel', keys)).toEqual(['app.title']);
  });

  it('should return nothing when every key is further away than maxDistance', () => {
    expect(findNearestKeys('completely.unrelated', keys)).toEqual([]);
  });

  it('should cap the number of results', () => {
    expect(findNearestKeys('app.ttle', ['app.title', 'app.tale', 'app.tile'], 3, 2)).toEqual([
      'app.title',
      'app.tale',
    ]);
  });

  // The boundary of the length pre-filter, and its control: a key exactly `maxDistance` apart
  // in length is still reachable, and a filter written with `>=` passes every assertion above.
  it('should still find a key whose length differs by exactly maxDistance', () => {
    expect([
      findNearestKeys('abc', ['abcdef'], 3),
      findNearestKeys('abc', ['abcdefg'], 3),
      findNearestKeys('abcdef', ['abc'], 3),
    ]).toEqual([['abcdef'], [], ['abc']]);
  });

  it('should keep the input order of equally-near keys', () => {
    expect(findNearestKeys('app.x', ['app.y', 'app.z'], 1)).toEqual(['app.y', 'app.z']);
  });
});
