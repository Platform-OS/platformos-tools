import lineColumn from 'line-column';
import { Position } from '../types';

/**
 * Character offset -> `{ line, character }`, in the Language Server Protocol's
 * document model.
 *
 * WHY THAT MODEL AND NOT ANOTHER. This is the only producer of `Offense.start` and
 * `Offense.end` (see `createContext` in `../index.ts`), and those positions are
 * consumed RAW by the language server: `offenseToDiagnostic` copies `line` and
 * `character` straight into an LSP `Range` with no conversion. The MCP supervisor is
 * the one consumer that converts, adding 1 to each for its agent-facing 1-based
 * line/column. So whatever this function means, VS Code renders — and the invariant
 * that keeps the extension honest is that this agrees, offset for offset, with the
 * LSP's own `TextDocument.positionAt`. `position.spec.ts` asserts exactly that
 * against the real implementation rather than against a restatement of it.
 *
 * BOTH VALUES ARE 0-BASED, and `character` counts UTF-16 code units, so an
 * astral-plane character advances it by 2. That is the LSP's default position
 * encoding and what the supervisor's `+ 1` assumes.
 *
 * TWO DEFECTS THIS REPLACED, both measured against `TextDocument.positionAt`:
 *
 *   1. CRLF. The previous implementation asked `line-column` for the column, and
 *      `line-column` counts a carriage return as an ordinary character of the line
 *      it terminates. An offset pointing at the `\n` of a `\r\n` therefore came back
 *      one PAST the end of the line's content — `10` on an 8-character line. The LSP
 *      walks such an offset back to the start of the terminator; we now do the same.
 *      Only offsets landing ON a terminator were ever affected, which is why three
 *      rounds of CRLF testing missed it: every fixture used a mid-line diagnostic.
 *
 *   2. END OF INPUT. `fromIndex` returns null past the last character, and the old
 *      code worked around that by clamping the lookup to `source.length - 1`. An
 *      offset of exactly `source.length` — a real position, and the one the `yaml`
 *      parser reports for every unterminated construct, as `[length, length + 1]` —
 *      was therefore reported on top of the last character instead of after it. The
 *      same clamp turned an EMPTY source into `line: -1, character: -1`, since
 *      `fromIndex(-1)` is null.
 *
 * LINE TERMINATORS ARE `\r\n`, `\n` AND A LONE `\r`, again because the LSP says so.
 * `line-column` splits on `\n` alone, so a classic-Mac file was one long line to us
 * and many lines to the editor rendering our diagnostics.
 */

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

function isLineTerminator(code: number): boolean {
  return code === LINE_FEED || code === CARRIAGE_RETURN;
}

/**
 * Offset at which each line begins. Index `i` holds the first offset of line `i`, so
 * the table always starts with 0 and a source ending in a terminator gets a final
 * entry equal to its length — the empty last line an editor shows.
 */
function computeLineStarts(source: string): number[] {
  const starts = [0];

  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (!isLineTerminator(code)) continue;
    // `\r\n` is ONE terminator. Consuming the `\n` here is what stops it opening an
    // empty line between the two halves of the pair.
    if (code === CARRIAGE_RETURN && source.charCodeAt(i + 1) === LINE_FEED) i++;
    starts.push(i + 1);
  }

  return starts;
}

/**
 * Single-entry memo, keyed on string IDENTITY.
 *
 * `report()` calls this twice per offense (start and end) with the same `file.source`
 * reference, and a file with thousands of offenses re-scanned the whole source for
 * every one of them. Keying on identity makes the repeat case a pointer comparison;
 * a different string with equal contents costs one string compare and then rebuilds,
 * which is still bounded by the work it replaces. The cache is a pure function of its
 * key, so a stale entry is impossible — the worst outcome is a rebuild.
 */
let cachedSource: string | undefined;
let cachedLineStarts: number[] = [0];

function lineStartsOf(source: string): number[] {
  if (source !== cachedSource) {
    cachedLineStarts = computeLineStarts(source);
    cachedSource = source;
  }
  return cachedLineStarts;
}

/** Index of the last line whose start is at or before `offset`. */
function lineAt(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

export function getPosition(source: string, index: number): Position {
  const offset = Math.max(0, Math.min(index, source.length));
  const lineStarts = lineStartsOf(source);
  const line = lineAt(lineStarts, offset);
  const lineStart = lineStarts[line];

  // Walk out of the line terminator. An offset addressing the `\n` of a `\r\n` names
  // a position between the two, which no line contains; the LSP resolves it to the
  // end of the line's content and so do we. Bounded by `lineStart` so the terminator
  // of the PREVIOUS line can never pull the position onto it.
  let end = offset;
  while (end > lineStart && isLineTerminator(source.charCodeAt(end - 1))) end--;

  return {
    // Deliberately the caller's index, not the clamped one: `index` is the value
    // `disabled-checks` and the code-action providers slice the source with, and
    // silently moving it would change what they cut. Only the line/character
    // projection is clamped, because only it has to name a place that exists.
    index,
    line,
    character: end - lineStart,
  };
}

/**
 * `{ line, column }` -> character offset, both 1-BASED.
 *
 * NOT the inverse of `getPosition`, and not meant to be. Its only caller is
 * `LiquidHTMLSyntaxError`, which converts a location the PARSER produced back into an
 * offset, and the parser builds those with `line-column`'s 1-based origin. This
 * function exists to speak that convention, so it stays on `line-column` and must
 * keep matching the parser rather than the LSP.
 */
export function getOffset(source: string, line: number, column: number): number {
  return lineColumn(source, { origin: 1 }).toIndex(line, column);
}
