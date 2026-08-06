import { isMap, isScalar, isSeq, parseDocument, Scalar, type Node, type Pair } from 'yaml';

import { normalizeLoneCarriageReturns } from './line-breaks';
import { reconcileFlowScalarContinuations } from './flow-scalar-continuations';

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
 * Source spellings where npm `yaml` and Psych are MEASURED to disagree, so the resolved value
 * cannot be trusted.
 *
 * These are no longer dropped entirely. They get a RAW identity keyed on the source text, so a
 * token still collides with an identical spelling of itself — see {@link identityOf}. Two
 * byte-identical keys are one key under any parser, so the disagreement that puts a token here
 * simply does not arise when it is compared against itself. Returning nothing meant `.inf: 1`
 * twice went unreported for 11 tokens.
 *
 * Every entry is a measurement, not a precaution. Left in, each one produces a false
 * positive — the expensive direction:
 *
 *   `y` `Y` `n` `N`   npm 1.1 resolves these to booleans; Psych leaves them STRINGS, and
 *                     keeps `y:` and `Y:` as TWO keys — measured, so the case is NOT folded
 *                     for them. A document with `y:` and `true:` would otherwise be reported
 *                     as a duplicate the platform does not have.
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
  // Case-INSENSITIVE, because Psych's is — measured: `.inf`, `.Inf`, `.INF` and `.iNf` are
  // all Float. The previous spelling listed three casings, so a fourth fell through to npm's
  // resolution instead of being excluded.
  /^[-+]?\.(inf|nan)$/i,
  /^\d{4}-\d{2}-\d{2}/,
];

/**
 * Psych's boolean spellings, which are CASE-INSENSITIVE over the whole word.
 *
 * MEASURED, and deliberately not the YAML 1.1 spec's list, which is wrong in both directions
 * for this parser:
 *
 *   `TrUe` `tRUE` `truE` `FaLsE` `yEs` `nO` `oN` `oFf`   all resolve to booleans in Psych.
 *                                                        npm's 1.1 mode leaves them STRINGS,
 *                                                        so `TrUe:` and `true:` were one key
 *                                                        on the platform and two here — a
 *                                                        silently discarded value.
 *   `y` `Y` `n` `N`                                      STRINGS in Psych, despite the spec
 *                                                        listing them as booleans. They stay
 *                                                        in {@link UNCOMPARABLE}.
 *
 * QUOTED SPELLINGS NEVER REACH THESE PATTERNS, and not for the reason it first appears. A
 * quoted key's `source` EXCLUDES its delimiters — measured — so `"yes"` arrives as the bare
 * text `yes` and would match. What keeps it out is the scalar-TYPE guard above, which returns
 * a String identity before any of this runs. Reasoning from the source text instead reported
 * `yes:` and `"yes":` as one key, which Psych keeps as two.
 */
const PSYCH_TRUE = /^(true|yes|on)$/i;
const PSYCH_FALSE = /^(false|no|off)$/i;

/**
 * Uncomparable spellings whose CASE does not change the key, so a raw identity folds it.
 *
 * Only the inf/nan family. Measured, and the reason this is not applied to everything that
 * reaches the raw identity: `.inf` and `.Inf` are ONE key to Psych, while `y` and `Y` are TWO.
 */
const CASE_FOLDED_RAW = /^[-+]?\.(inf|nan)$/i;

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

  // A QUOTED OR BLOCK SCALAR IS A STRING ON BOTH SIDES, and none of the plain-scalar reasoning
  // below applies to it. This has to be decided by the scalar's TYPE, not by looking for quotes
  // in `source` — measured, `source` EXCLUDES the delimiters, so `"yes"` arrives here as the
  // bare text `yes`, indistinguishable from the plain `yes` that Psych resolves to a boolean.
  //
  // Getting this wrong is a FALSE POSITIVE, which is the expensive direction: a first version
  // of the boolean handling below reasoned that "a quoted key's source includes its quotes" and
  // immediately reported `yes:` and `"yes":` as one key, which Psych keeps as two. It also
  // repairs a latent case that predates this change — `".inf"` would have shared an identity
  // with the plain `.inf`, and those are a String and a Float to Psych.
  if (pair.key.type !== undefined && pair.key.type !== Scalar.PLAIN) {
    return `string ${String(pair.key.value)}`;
  }

  // IDENTICAL SOURCE TEXT NEEDS NO RESOLUTION, which is why an uncomparable token still gets
  // an identity rather than being dropped.
  //
  // {@link UNCOMPARABLE} exists because npm `yaml` and Psych resolve these spellings
  // DIFFERENTLY, so comparing one against a different spelling risks a false positive. That
  // argument does not apply to a token compared against ITSELF: the same bytes resolve to the
  // same object under any one parser, so two byte-identical keys are one key on every
  // platform, deterministically. Returning `undefined` here meant `.inf: 1` twice in one
  // mapping went unreported — Psych keeps `{Infinity => 2}`, a value silently discarded —
  // along with 10 other tokens.
  //
  // Prefixed so it can never alias a RESOLVED identity: `raw 1e3` and `number int 1000` are
  // different strings, which is correct, because Psych reads `1e3` as the String "1e3" and
  // keeps two keys. So the raw identity is not merely sound, it is silent in exactly the
  // cases where returning `undefined` was silent, and reports the one case it could not.
  // Case is folded for the inf/nan family ONLY, and the boundary is measured in both
  // directions rather than applied uniformly:
  //
  //   `.inf` + `.Inf`   ONE key   -> must share an identity, so the case is folded
  //   `y` + `Y`         TWO keys  -> folding them would be a FALSE POSITIVE, so case is kept
  //   `-.inf` + `.inf`  TWO keys  -> the sign is significant, so it survives the fold
  //
  // Folding everything reaching this branch would have looked tidier and been wrong.
  if (UNCOMPARABLE.some((pattern) => pattern.test(source))) {
    const canonical = CASE_FOLDED_RAW.test(source) ? source.toLowerCase() : source;
    return `raw ${canonical}`;
  }

  // Resolved the way PSYCH resolves it, not the way npm does — see PSYCH_TRUE/PSYCH_FALSE.
  if (PSYCH_TRUE.test(source)) return 'boolean true';
  if (PSYCH_FALSE.test(source)) return 'boolean false';

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
  const options = {
    prettyErrors: false,
    uniqueKeys: false,
    version: '1.1' as const,
  };
  const normalized = normalizeLoneCarriageReturns(source);
  const doc = parseDocument(normalized, options);

  // A QUOTED SCALAR CONTINUED AT OR BELOW ITS KEY'S INDENTATION does not parse under YAML 1.2
  // — see `flow-scalar-continuations.ts`. This parse is SEPARATE from `toYAMLNode`'s because
  // it needs 1.1 scalar resolution for key identity, so it needs the reconciliation
  // separately too: without it a duplicate key anywhere in such a file was silently missed,
  // which is a coverage gap the false-block fix would otherwise have left behind.
  //
  // The reconciliation is byte-for-byte, so every range reported below is still an offset
  // into the caller's original source. Scalar VALUES are not re-folded here, unlike in
  // `toYAMLNode`: this function only ever compares KEYS, and a multi-line quoted key would
  // land in `UNCOMPARABLE` on its source text long before folding could matter.
  const reconciled =
    doc.errors.filter((error) => error.code !== 'MULTIPLE_DOCS').length > 0
      ? reconcileFlowScalarContinuations(normalized, options)
      : null;
  const contents = reconciled ? reconciled.doc.contents : doc.contents;

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

  visit(contents);

  return found.sort((a, b) => a.discardedStart - b.discardedStart);
}
