/**
 * A Liquid string literal whose closing quote the author escaped, C style.
 *
 * MEASURED on a live instance (2026-08-20, engine `463805653cae`), because the two string
 * dialects in a template disagree:
 *
 *   Liquid literal  `{% assign x = "a \"b\"" %}`         -> value `a \`, nothing raises.
 *                   A literal runs to the very next quote of the same kind; there are no
 *                   escapes, so the quote after the backslash CLOSES it.
 *   JSON literal    `{% assign o = { "k": "a \"b\"" } %}` -> value `a "b"`. Legitimate, and
 *                   unreachable here: a JSON literal parses strictly, so its markup is not
 *                   the raw string this scanner is given.
 *
 * A pure string function: the markup it reads is the markup the strict grammar refused, so
 * there is no tree to walk. `liquid-html-syntax-error` imports it to stay silent on the same
 * cause.
 */

/** What follows a closed literal when nothing was truncated: a separator, or nothing. */
const CONTINUES_THE_EXPRESSION = /^[\s,|:)\]}]/;

export interface EscapedClosingQuote {
  /** Offset of the opening quote, within the markup. */
  index: number;
  /** Offset one past the closing quote of the literal the AUTHOR intended, within the markup. */
  endIndex: number;
  /** The literal as Liquid reads it, quotes included: `"it's a \"`. */
  literal: string;
  /** The value Liquid holds: `it's a \`. */
  value: string;
  /** The text left outside the string, up to where the author closed it: `test\""`. */
  outside: string;
  /** The literal the author meant to write, quotes included: `"it's a \"test\""`. */
  intended: string;
  /** The quote character the literal opened with. */
  quote: '"' | "'";
}

function isQuote(char: string): char is '"' | "'" {
  return char === '"' || char === "'";
}

/**
 * An ODD number of backslashes is an author escaping the quote (`"it's a \"test\""`); an even
 * number is a literal backslash before a quote that legitimately closes (`"a\\"`).
 */
function escapesTheQuote(markup: string, openIndex: number, closeIndex: number): boolean {
  let backslashes = 0;
  for (let i = closeIndex - 1; i > openIndex && markup[i] === '\\'; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

/** Where the author thought the literal ended: the next quote they did NOT escape. */
function intendedEnd(markup: string, from: number, quote: '"' | "'"): number {
  for (let i = from; i < markup.length; i++) {
    if (markup[i] !== quote) continue;
    if (markup[i - 1] === '\\') continue;
    return i + 1;
  }
  return markup.length;
}

/** Every literal in `markup` whose closing quote the author tried to escape. */
export function findUnsupportedStringEscapes(markup: string): EscapedClosingQuote[] {
  const found: EscapedClosingQuote[] = [];
  let index = 0;

  while (index < markup.length) {
    const quote = markup[index];
    if (!isQuote(quote)) {
      index++;
      continue;
    }

    const close = markup.indexOf(quote, index + 1);
    // An unterminated literal is a different defect, reported elsewhere.
    if (close === -1) break;

    const rest = markup.slice(close + 1);
    // A separator, or nothing, after the closing quote means nothing was truncated.
    const truncated = rest.length > 0 && !CONTINUES_THE_EXPRESSION.test(rest);

    if (truncated && escapesTheQuote(markup, index, close)) {
      const end = intendedEnd(markup, close + 1, quote);
      const literal = markup.slice(index, close + 1);
      found.push({
        index,
        endIndex: end,
        literal,
        value: literal.slice(1, -1),
        outside: markup.slice(close + 1, end),
        intended: markup.slice(index, end),
        quote,
      });
      // past the whole broken literal: the quotes inside it are the author's
      index = end;
      continue;
    }

    index = close + 1;
  }

  return found;
}
