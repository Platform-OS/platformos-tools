import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from 'yaml';

import { normalizeLoneCarriageReturns } from './line-breaks';

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
 * THE PARSER AND THE PLATFORM DISAGREE ABOUT SCALARS, and that is the hard part of this
 * module. npm `yaml` implements YAML **1.2**; Psych/libyaml implements YAML **1.1**. The
 * question here — "does the platform see one key or two" — therefore cannot be answered
 * from the default parse, and an earlier version of this file got it wrong in BOTH
 * directions at once:
 *
 *   `yes:` / `true:`   reported as distinct, "because YAML 1.2 resolves `yes` to a
 *                      string". True of this parser, FALSE of the platform: Psych gives
 *                      boolean `true` for both, so a value was being silently discarded
 *                      and the check stayed quiet while documenting that it was right to.
 *   `1:` / `1.0:`      reported as a duplicate. Psych keeps `Integer(1)` and `Float(1.0)`
 *                      as two keys, so this was a FALSE POSITIVE on legal input, inviting
 *                      an author to delete a working key.
 *
 * So the document is re-parsed at **version 1.1** for identity purposes only, which fixes
 * the boolean family and 1.1 octal in one move. That is not sufficient on its own —
 * npm's 1.1 mode is not Psych either — see {@link UNCOMPARABLE}.
 *
 * INTEGER AND FLOAT ARE DIFFERENT KEYS even at the same numeric value, because Ruby's
 * Hash uses `eql?`: `1.eql?(1.0)` is false. JS has one number type, so the distinction
 * has to come from the SOURCE TEXT.
 *
 * SOUNDNESS OVER COMPLETENESS. Where the two parsers cannot be reconciled, this reports
 * NOTHING. A missed duplicate costs one silently-dropped value; a false one asks an
 * author to delete working code, and this linter has spent five evaluation rounds
 * learning which of those is more expensive. `duplicate-keys.spec.ts` asserts the
 * soundness direction exhaustively against `psych-key-identity.ts`, which is generated
 * from Ruby itself.
 *
 * ALSO NOT A DUPLICATE: `<<` twice. Merge keys are repeatable under YAML 1.1 merge
 * semantics and what the platform does with them has not been measured.
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
 * Source spellings where npm `yaml` and Psych are MEASURED to disagree, and which are
 * therefore never compared to anything.
 *
 * Every entry is a measurement, not a precaution. Left in, each one produces a false
 * positive — the expensive direction:
 *
 *   `y` `Y` `n` `N`   npm 1.1 resolves these to booleans; Psych leaves them STRINGS. A
 *                     document with `y:` and `true:` would be reported as a duplicate
 *                     the platform does not have.
 *   `1e3` and kin     Psych does not treat unquoted scientific notation as a number at
 *                     all — it is the String "1e3" — while npm resolves it to 1000, so
 *                     `1e3:` and `1000:` would look like a collision.
 *   `0X10` uppercase  Psych resolves lowercase `0x10` to Integer 16 and uppercase `0X10`
 *                     to the String "0X10". npm accepts both as 16.
 *   `1:30` base-60    A YAML 1.1 sexagesimal. Both parsers resolve it to a number and
 *                     they disagree about WHICH: Psych 5400, npm 90.
 *   `.inf` `.nan`     npm reports a null VALUE for these, which would collide with a
 *                     genuine `null:` key.
 *   timestamps        npm builds a Date; Ruby's safe loader refuses to, so which object
 *                     the platform ends up with depends on a loader this repo has not
 *                     established.
 *
 * The spec asserts that every pattern here really is a disagreement, so the list cannot
 * quietly grow into a way of silencing inconvenient cases.
 */
const UNCOMPARABLE: readonly RegExp[] = [
  /^[yYnN]$/,
  /^[-+]?(\d[\d_]*)?\.?\d+[eE][-+]?\d+$/,
  /^[-+]?0X/,
  /^[-+]?\d[\d_]*(:[0-5]?\d)+$/,
  /^[-+]?\.(inf|Inf|INF|nan|NaN|NAN)$/,
  /^\d{4}-\d{2}-\d{2}/,
];

/**
 * Whether the source text spells a FLOAT rather than an integer.
 *
 * Ruby distinguishes them and JS does not, so this reads the token. Safe because every
 * numeric form where a dot does not mean "float" — scientific notation, sexagesimals,
 * `.inf`, `.nan` — is already {@link UNCOMPARABLE} and never reaches here.
 */
function isFloatToken(source: string): boolean {
  return source.includes('.');
}

/**
 * An identity that matches the platform's notion of key equality, or `undefined` when
 * this key must not be compared at all.
 *
 * The scalar's `value` here comes from a version-1.1 parse, so the boolean family and
 * 1.1 octal already agree with Psych; `source` supplies what the resolved value cannot.
 */
function identityOf(pair: Pair): string | undefined {
  if (!isScalar(pair.key)) return undefined;

  // `source` is the raw token. Absent for keys the parser synthesised rather than read,
  // which cannot be compared by spelling and are therefore left alone.
  const source = (pair.key as { source?: string }).source;
  if (source === undefined) return undefined;

  // MATCHED ON THE SOURCE, not on the resolved value, because the resolved value is not
  // stable across versions: at 1.1 the parser recognises `<<` as a merge token and leaves
  // `value` undefined, so a check for the STRING `'<<'` silently stopped matching and the
  // two merge keys started reporting as a duplicate.
  if (source === MERGE_KEY) return undefined;

  if (UNCOMPARABLE.some((pattern) => pattern.test(source))) return undefined;

  const value = pair.key.value;

  if (typeof value === 'number') {
    return `number ${isFloatToken(source) ? 'float' : 'int'} ${value}`;
  }
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
  // VERSION 1.1, unlike `toYAMLNode`, and only here. The platform's parser is Psych,
  // which is a 1.1 implementation, so `yes` is boolean `true` and `014` is 12 — both
  // measured. Verified that this changes neither the item structure nor the ranges, so
  // offsets from this parse are the ones `toYAMLNode` would have given.
  //
  // The GLOBAL parse deliberately stays at 1.2. Moving it would retype every scalar every
  // check sees — a translation key literally named `yes` would become boolean `true` —
  // which is a much larger decision than this one and needs its own measurement.
  //
  // `uniqueKeys: false` matches `toYAMLNode`: a repeated key must not be a parse error.
  // Both pairs survive in `items` either way, which is what makes this findable at all.
  //
  // Lone carriage returns are normalized for the same reason `toYAMLNode` does it: the
  // platform treats them as line breaks and this parser does not.
  const doc = parseDocument(normalizeLoneCarriageReturns(source), {
    prettyErrors: false,
    uniqueKeys: false,
    version: '1.1',
  });

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
