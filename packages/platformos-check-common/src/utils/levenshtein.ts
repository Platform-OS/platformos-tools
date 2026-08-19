/**
 * Edit distance between two strings, in two rows rather than an (a+1)x(b+1) matrix: each cell
 * depends only on the row above it and the cell to its left, and the allocation — not the
 * comparisons — is what {@link findNearestKeys} pays per candidate key.
 */
export function levenshtein(a: string, b: string): number {
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1]
          : 1 + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    // Swap rather than copy: the row displaced becomes scratch for the next pass.
    [previous, current] = [current, previous];
  }

  // The swap left the last row computed in `previous`; for an empty `a` that is still the
  // initial row, whose last cell is `b.length`.
  return previous[b.length];
}

/**
 * Whether every value in a map is a scalar — no nested map, no list.
 *
 * Such a map is a LEAF GROUP: a pluralization (`{ one, other }`, selected by `count:`), or
 * a flat bag of strings a caller takes whole (`{{ 'photo_uploads' | t | to_json }}` feeds an
 * uploader's locale strings; `{{ 'groups.types' | t | dig: type }}` picks one out). Measured
 * against the runtime, `t` on it returns the map, so the parent is a key an author writes.
 *
 * A map with any nested map is a NAMESPACE and contributes only its children, which is what
 * keeps `'groups' | t` — a whole subtree nobody means to render — still reported.
 */
function isLeafGroup(value: Record<string, any>): boolean {
  const values = Object.values(value);
  // `typeof null` and `typeof []` are both 'object', so the null arm and the array arm are
  // each doing work: a null value is a scalar, a list value makes this a namespace.
  return values.length > 0 && values.every((v) => v === null || typeof v !== 'object');
}

/**
 * Every key a `{{ '…' | t }}` can name.
 *
 * A NAMESPACE (a map holding further maps) contributes its children rather than itself. A
 * LIST does not: `t` returns the whole list, and `{{ 'app.relationships.type' | t |
 * parse_json }}` is how a project reads one — descending into it produced `…type.0`,
 * `…type.1` and left the key the author actually writes looking undefined.
 *
 * A LEAF GROUP contributes BOTH itself and its children, for the same reason the list does:
 * `t` hands back the map. `members: { one: …, other: … }` is written `'…members' | t:
 * count: n`, and `'…members.one' | t` is legal too, so neither spelling may be dropped.
 * Emitting only the leaves was a false BLOCK on the ordinary way to write a plural and on
 * every flat group a caller reads whole.
 */
export function flattenTranslationKeys(obj: Record<string, any>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (isLeafGroup(v)) keys.push(full);
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
  const near: { key: string; distance: number }[] = [];

  for (const key of allKeys) {
    // A length difference is a lower bound on the distance, so a key further apart in
    // length than `maxDistance` cannot be within it and never reaches the O(n*m) comparison.
    if (Math.abs(key.length - missingKey.length) > maxDistance) continue;

    const distance = levenshtein(missingKey, key);
    if (distance <= maxDistance) near.push({ key, distance });
  }

  // Sort is stable, so equally-near keys keep the order `allKeys` gave them.
  return near
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ key }) => key);
}
