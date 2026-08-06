import { parseDocument } from 'yaml';
import type { Document, ParseOptions, DocumentOptions, SchemaOptions } from 'yaml';

/**
 * Make the parser agree with the platform about how a QUOTED scalar may be continued.
 *
 * THE MISMATCH THIS EXISTS FOR, and it is a second one — see `line-breaks.ts` for the first.
 * npm `yaml` implements YAML 1.2, which requires a flow scalar's continuation line to be
 * indented MORE than its parent node. Ruby Psych/libyaml accepts equal or lesser indentation,
 * including column 0. So the ordinary thing a translator does — continue a long string on the
 * next line, aligned under the key —
 *
 *   ```yaml
 *   en:
 *     k: "Hello
 *     world"
 *   ```
 *
 * is `MISSING_CHAR: Missing closing "quote` to a 1.2 parser and a plain string to the
 * platform. That is a `YAMLSyntaxError`, which BLOCKS, on a file `pos-cli deploy --dry-run`
 * accepts and Psych reads as `{"en" => {"k" => "Hello world"}}`.
 *
 * WHY NOT AN OPTION. Measured, all four combinations: neither `version: '1.1'` nor
 * `strict: false` changes this, alone or together. TASK-43 found the same for line breaks;
 * this is a separate mechanism and was measured separately rather than assumed to match.
 *
 * WHY NOT FILTER THE ERROR CODE. Because it is not diagnostic. `MISSING_CHAR` is reported for
 * the shapes above AND for a genuinely unterminated quote, an unquoted multi-line value, and
 * bad block indentation — measured. Suppressing the code would trade this false block for
 * false approvals on a check that blocks, which is strictly worse.
 *
 * WHY NOT THE LIBRARY'S CST. Its `Lexer` has already resolved the question the wrong way by
 * the time we could ask: it emits `"Hello` as a complete scalar token and `world"` as the
 * next one, so there is nothing there to reuse.
 *
 * SO THE PARSER'S OWN ERROR POSITIONS DRIVE THE FIX. For each `MISSING_CHAR`, the line break
 * ending that error's line is replaced with a space and the document is re-parsed. Nothing is
 * accepted unless the document then parses cleanly, which is what makes this sound: the
 * decision is never "this looks like the 1.1 shape", it is "the platform's reading of these
 * bytes is a valid document". A genuinely unterminated quote has no line break after the
 * error to substitute, and a non-`MISSING_CHAR` failure is refused outright.
 *
 * WHY THIS IS SAFE FOR POSITIONS. The substitution is ONE BYTE FOR ONE BYTE, so every offset
 * in the reconciled document is still an offset into the caller's original source and every
 * diagnostic computed from it points at the right characters. That is the same bar
 * `line-breaks.ts` clears, and it is the reason a re-indenting fix was rejected: adding spaces
 * would shift every offset after the first continuation.
 *
 * WHAT THE SUBSTITUTION GETS WRONG, and how it is repaired. Turning the break into a space
 * leaves the continuation's own indentation inside the scalar, so the value comes back
 * `"Hello   world"` where YAML folds to `"Hello world"`. The offsets are right and the value
 * is not, so {@link foldedScalarValue} re-derives it from the ORIGINAL source. Leaving it
 * would put a value in the AST that the platform does not have — small today, because nothing
 * compares translation values by exact spacing, and exactly the kind of confident false
 * premise that produces the next defect.
 */

/** Options accepted by `parseDocument`, as this module passes them straight through. */
type YamlParseOptions = ParseOptions & DocumentOptions & SchemaOptions;

/** The `yaml` error code for an unclosed quoted scalar. */
const MISSING_CHAR = 'MISSING_CHAR';

/**
 * `MULTIPLE_DOCS` is our calling convention rather than the author's mistake — see the note in
 * `parse.ts` — so it must not count as a failure when deciding whether reconciliation worked.
 */
const isFailure = (error: { code: string }) => error.code !== 'MULTIPLE_DOCS';

export interface Reconciliation {
  /** The document, parsed from the reconciled source. */
  doc: Document.Parsed;
  /**
   * Offsets in the ORIGINAL source of every line break replaced by a space, ascending. Never
   * empty: a reconciliation that substituted nothing is not a reconciliation.
   */
  breaks: readonly number[];
}

/**
 * Re-parse `source` as the platform would read it, or `null` when it is genuinely invalid.
 *
 * Only ever called after a normal parse has already failed, so the cost is paid by broken
 * files rather than by every file. Bounded by the number of line breaks, so it cannot spin on
 * a pathological input.
 */
export function reconcileFlowScalarContinuations(
  source: string,
  options: YamlParseOptions,
): Reconciliation | null {
  const breaks: number[] = [];
  let candidate = source;

  // One substitution per round, and every round must consume a line break, so the bound is
  // the number of line breaks in the file.
  const maxRounds = countLineBreaks(source) + 1;

  for (let round = 0; round < maxRounds; round++) {
    const doc = parseDocument(candidate, options);
    const failures = doc.errors.filter(isFailure);

    if (failures.length === 0) {
      // Nothing was wrong to begin with; the caller should not have asked.
      if (breaks.length === 0) return null;
      return { doc, breaks };
    }

    // Act on the first unclosed quote, and bail only when there is NO unclosed quote left to
    // act on. Deliberately NOT "bail if any other code is present": an intermediate state can
    // legitimately carry a mixed set — `en:\n  k: "Hello\n  world"\n  j: 2\n` reports a
    // `BAD_INDENT` alongside the `MISSING_CHAR` until the substitution is made, and refusing
    // there was a false block on a valid file.
    //
    // Tolerating the mix costs no soundness, because acceptance is decided by the FINAL parse
    // being clean rather than by any intermediate state. A file with a real error alongside a
    // continuation never reaches a clean parse, so it still returns null and reports its own
    // errors.
    const unclosedQuotes = failures.filter((failure) => failure.code === MISSING_CHAR);
    if (unclosedQuotes.length === 0) return null;

    const [errorStart] = unclosedQuotes[0].pos;
    const lineBreak = candidate.indexOf('\n', errorStart);
    // No line break after the error means the quote really is unterminated: there is no
    // continuation, so there is nothing the platform would read differently.
    if (lineBreak === -1) return null;
    // Already substituted this one, so no progress is possible. Defensive: `indexOf` cannot
    // return a substituted position, because a substituted position no longer holds `\n`.
    if (breaks.includes(lineBreak)) return null;

    candidate = `${candidate.slice(0, lineBreak)} ${candidate.slice(lineBreak + 1)}`;
    breaks.push(lineBreak);
  }

  return null;
}

/**
 * The correctly FOLDED value of the quoted scalar occupying `[start, end)` of the original
 * source, or `undefined` when that span does not parse as a scalar on its own.
 *
 * Parsing the span standalone is what folds it, and it folds correctly because a top-level
 * flow scalar has no parent indentation to be measured against. Verified against Ruby Psych
 * on five shapes, including the one that decides it — a continuation whose previous line ends
 * in whitespace, where both fold to a single space and drop the rest:
 *
 *   `"Hello\n  world"`      -> "Hello world"
 *   `'Hello\n  world'`      -> "Hello world"
 *   `"a\n  b\n  c"`         -> "a b c"
 *   `"Hello\nworld"`        -> "Hello world"
 *   `"trailing  \n  x"`     -> "trailing x"
 */
export function foldedScalarValue(
  originalSource: string,
  start: number,
  end: number,
  options: YamlParseOptions,
): unknown {
  const doc = parseDocument(originalSource.slice(start, end), options);
  if (doc.errors.filter(isFailure).length > 0) return undefined;

  const value = doc.toJS();
  // Anything but a scalar means the span was not what we thought; the caller keeps its own.
  return value === null || typeof value === 'object' ? undefined : value;
}

/** Whether `[start, end)` contains any of `breaks`, i.e. whether this node was reconciled. */
export function spansReconciledBreak(
  breaks: readonly number[],
  start: number,
  end: number,
): boolean {
  return breaks.some((offset) => offset >= start && offset < end);
}

function countLineBreaks(source: string): number {
  let count = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') count++;
  }
  return count;
}
