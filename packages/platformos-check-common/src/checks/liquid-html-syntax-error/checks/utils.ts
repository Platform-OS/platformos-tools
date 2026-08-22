export const INVALID_SYNTAX_MESSAGE = 'Syntax is not supported';

export function getValuesInMarkup(markup: string) {
  return [...markup.matchAll(new RegExp(VALUE_PATTERN, 'g'))].map((match) => ({
    value: match[0],
    index: match.index,
  }));
}

const DOUBLE_QUOTED_STRING = `"[^"]*"`;
const SINGLE_QUOTED_STRING = `'[^']*'`;
// Lax parser does NOT complain about leading/trailing spaces inside ranges (e.g. `(1 .. 10 )`) and
// within the parenthesis (e.g. `( 1 .. 10 )`), but fails to render the liquid when using the gem.
// Strict parser does NOT complain, but still renders it.
// To avoid any issues, we will remove extra spaces.
const RANGE_MARKUP_COMPONENT_REGEX = `\\s*(-?\\d+(?:\\.\\d+)?|\\w+(?:\\.\\w+)*)\\s*`;
const RANGE_MARKUP_REGEX = `\\(\\s*${RANGE_MARKUP_COMPONENT_REGEX}(\\.{2,})\\s*${RANGE_MARKUP_COMPONENT_REGEX}\\s*\\)`;
const REGULAR_TOKEN = `[^\\s,]+`; // tokens separated by commas or spaces

// Quoted strings pattern (combination of double and single quoted)
const QUOTED_STRING = `(${DOUBLE_QUOTED_STRING}|${SINGLE_QUOTED_STRING})`;

// Value pattern for key-value pairs (can be quoted, parenthesized, or regular token)
const VALUE_PATTERN = `(${QUOTED_STRING}|${RANGE_MARKUP_REGEX}|${REGULAR_TOKEN})`;

// Key-value pair pattern
const KEY_VALUE_PAIR = `(\\S+):\\s*${VALUE_PATTERN}`;

const MARKUP_FRAGMENTS_PATTERN = new RegExp(
  `${QUOTED_STRING}|${RANGE_MARKUP_REGEX}|${KEY_VALUE_PAIR}|${REGULAR_TOKEN}`,
  'g',
);

export function getFragmentsInMarkup(markup: string) {
  return [...markup.matchAll(MARKUP_FRAGMENTS_PATTERN)].map((match) => ({
    value: match[0],
    index: match.index,
  }));
}

export function getRangeMatch(markup: string) {
  return markup.match(RANGE_MARKUP_REGEX);
}

export function doesFragmentContainUnsupportedParentheses(fragment: string) {
  if (getRangeMatch(fragment)) {
    return false;
  }

  return fragment.includes('(') || fragment.includes(')');
}

/**
 * Liquid's WORD operators. `contains` is Liquid's own comparison keyword, `and` / `or` its
 * boolean ones. A variable could in principle be named after one of these; the only cost of
 * treating it as an operator is that we report without offering a fix.
 */
const WORD_OPERATORS: ReadonlySet<string> = new Set(['and', 'or', 'contains']);

/** A token made ENTIRELY of operator punctuation: `?`, `:`, `&&`, `==`, `>=`, `+`, a bare `-`. */
const PUNCTUATION_OPERATOR = /^[?:&|=<>!+*\/%-]+$/;

/**
 * A ternary marker fused to an operand, as in `a ?b :c` or `a? b`, which the token pattern
 * returns as one token rather than as a bare `?`.
 */
const TERNARY_MARKER = /[?:]/;

/**
 * Whether a token from {@link getValuesInMarkup} is an OPERATOR rather than a value.
 *
 * A quoted string is a value even when it spells an operator — `'a?b'` and `':'` are data —
 * so quoting is checked first. `-5` is a value because it is not punctuation alone; a bare
 * `-` is an operator.
 */
export function isOperatorToken(token: string): boolean {
  if (token.startsWith("'") || token.startsWith('"')) {
    return false;
  }

  if (WORD_OPERATORS.has(token)) {
    return true;
  }

  return PUNCTUATION_OPERATOR.test(token) || TERNARY_MARKER.test(token);
}

/**
 * Whether a value section is an EXPRESSION the author wrote rather than a value followed by
 * stray tokens.
 *
 * This is the guard on every fix that repairs unsupported markup by keeping the first value
 * and DELETING the rest. That deletion reproduces what platformOS's lax parser does —
 * measured on a live instance, `{% assign foo = '123' 555 text %}` renders `123` — which is
 * a repair when the tail is meaningless and a SILENT REWRITE when it is an operand:
 * `flag ? 'yes' : 'no'` becomes `flag`, renders `true`, and deploys clean. The deploy
 * converter REJECTS every one of these constructs today, so applying such a fix trades a
 * loud failure for a wrong value that nothing downstream can detect.
 *
 * The whole section is scanned, not just the part that would be deleted, so an operator in
 * leading position (`= + 2`) is caught as well.
 *
 * Callers must keep REPORTING; only the fix is withheld.
 */
export function hasExpressionOperator(valueSection: string): boolean {
  return getValuesInMarkup(valueSection).some(({ value }) => isOperatorToken(value));
}

export function fragmentKeyValuePair(fragment: string) {
  const match = fragment.match(new RegExp(KEY_VALUE_PAIR));

  if (!match) {
    return;
  }

  const [, key, value] = match;

  return {
    key,
    value,
  };
}
