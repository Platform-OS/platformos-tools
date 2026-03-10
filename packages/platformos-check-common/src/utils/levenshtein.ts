export function levenshtein(a: string, b: string): number {
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

export function flattenTranslationKeys(
  obj: Record<string, any>,
  prefix = '',
): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenTranslationKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

export function findNearestKeys(
  missingKey: string,
  allKeys: string[],
  maxDistance = 3,
  maxResults = 3,
): string[] {
  return allKeys
    .map((key) => ({ key, distance: levenshtein(missingKey, key) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ key }) => key);
}
