import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from 'yaml';

/**
 * Find keys a YAML mapping defines more than once.
 *
 * WHY THIS IS NOT A PARSE ERROR, and why it is worth finding anyway. A repeated key is
 * legal input: `pos-cli deploy --dry-run` accepts it, and the platform resolves it
 * LAST-WINS — measured 2026-08-02 by deploying a translations file with a key defined
 * twice at the top level and twice inside a nested map, then reading both back through
 * `liquid_exec`. Both returned the second value; a key that was never defined returns
 * "translation missing", so the resolution is real rather than a fallback.
 *
 * That measurement is the whole basis for the remedy this produces, and it is recorded
 * here because it did not exist before. Every earlier claim of "last-wins" in this
 * repository — including one in `parse.ts` — rode along in a sentence about `--dry-run`
 * ACCEPTING the file, which is a different question. Acceptance was measured; resolution
 * was assumed.
 *
 * So the file deploys and works, and the earlier value is silently gone. In a
 * translations file that is a string the author wrote and will never see.
 *
 * WHAT IS DELIBERATELY NOT A DUPLICATE. Each of these is legal input that a naive
 * comparison reports, and reporting legal input is this linter's most expensive failure:
 *
 *   `1:` and `"1":`   distinct YAML scalars — a number and a string. Ruby keeps BOTH as
 *                     separate Hash keys, so they are not a collision on the platform.
 *                     (`toJS()` collapses them because JS object keys are strings; that
 *                     is a property of the JS model, not of the document.)
 *   `yes:` / `true:`  same reasoning — YAML 1.2 resolves `yes` to a string and `true` to
 *                     a boolean, so they are different keys.
 *   `<<:` twice       merge keys. Repeating them is meaningful under YAML 1.1 merge
 *                     semantics, and what the platform does with them has not been
 *                     measured. Silence is the safe direction until it is.
 *
 * Keys are therefore compared by resolved TYPE AND VALUE, never by their source text.
 */

/** One key defined more than once in the same mapping. */
export interface DuplicateKey {
  /** The key as written, for the message. */
  key: string;
  /**
   * Offsets of the occurrence whose value is DISCARDED — the whole `key: value` entry,
   * so the reported range covers the line that does nothing rather than just its key.
   */
  discardedStart: number;
  discardedEnd: number;
  /** Start offset of the occurrence that survives, so the message can name its line. */
  survivorStart: number;
}

/** YAML merge key. Repeating it is meaningful; see the module comment. */
const MERGE_KEY = '<<';

/**
 * An identity that matches the platform's notion of key equality.
 *
 * Type-qualified on purpose: `1` and `'1'` are one key in a JS object and two in a Ruby
 * Hash, and the platform is the authority here.
 */
function identityOf(pair: Pair): string | undefined {
  if (!isScalar(pair.key)) return undefined;
  const value = pair.key.value;
  if (value === MERGE_KEY) return undefined;
  return `${typeof value} ${String(value)}`;
}

/** The offsets an entry occupies, from the key through the end of its value. */
function entryRange(pair: Pair): { start: number; end: number } | undefined {
  const key = pair.key as Node | null;
  if (!key?.range) return undefined;

  const value = pair.value as Node | null;
  // A key with no value (`a:`) has no value range to extend to, so the entry is the key.
  const end = value?.range?.[1] ?? key.range[1];
  return { start: key.range[0], end: Math.max(end, key.range[1]) };
}

/**
 * Every duplicated key in the document, in source order of the DISCARDED occurrence.
 *
 * Three occurrences of one key produce two entries: everything but the last is discarded,
 * and every entry points at the same survivor — the last one — because that is the value
 * the platform ends up with. Pointing each discard at the *next* occurrence instead would
 * be accurate about the pairwise shadowing and useless about the outcome.
 */
export function findDuplicateKeys(source: string): DuplicateKey[] {
  // `uniqueKeys: false` matches `toYAMLNode`: a repeated key must not be a parse error.
  // Both pairs survive in `items` either way, which is what makes this findable at all.
  const doc = parseDocument(source, { prettyErrors: false, uniqueKeys: false });

  const found: DuplicateKey[] = [];

  const visit = (node: unknown): void => {
    if (isSeq(node)) {
      // Sequences hold maps, and a duplicate inside a sequence item is as real as one at
      // the top level — measured: `items:\n  - a: 1\n    a: 2` resolves to `{a: 2}`.
      for (const item of node.items) visit(item);
      return;
    }
    if (!isMap(node)) return;

    const occurrences = new Map<string, Pair[]>();
    for (const pair of node.items) {
      const identity = identityOf(pair);
      if (identity !== undefined) {
        const seen = occurrences.get(identity);
        if (seen) seen.push(pair);
        else occurrences.set(identity, [pair]);
      }
      visit(pair.value);
    }

    for (const pairs of occurrences.values()) {
      if (pairs.length < 2) continue;

      const survivor = pairs[pairs.length - 1];
      const survivorRange = entryRange(survivor);
      if (!survivorRange) continue;

      for (const discarded of pairs.slice(0, -1)) {
        const range = entryRange(discarded);
        if (!range) continue;
        found.push({
          key: String(isScalar(discarded.key) ? discarded.key.value : ''),
          discardedStart: range.start,
          discardedEnd: range.end,
          survivorStart: survivorRange.start,
        });
      }
    }
  };

  visit(doc.contents);

  return found.sort((a, b) => a.discardedStart - b.discardedStart);
}
