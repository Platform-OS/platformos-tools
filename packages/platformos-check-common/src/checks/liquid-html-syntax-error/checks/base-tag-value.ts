/**
 * What value a `Liquify::Tags::Base`-derived tag actually receives for given raw markup.
 *
 * Mirrors two pieces of platformOS, and is only correct while they are:
 *
 *   app/lib/liquid/quoted_string_escapes.rb
 *     QuotedString   = /"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'/
 *     QuotedFragment = /QuotedString|(?:[^\s,\|'"]|QuotedString)+/
 *   app/lib/liquify/tags/base_tag_methods.rb
 *     SYNTAX matched UNANCHORED; group 1 is the value, the rest becomes attributes.
 *
 * Two consequences drive everything here. An unescaped delimiter TERMINATES a literal, so
 * `'a'b'` is three tokens rather than one string; and a run ends at whitespace, comma or
 * pipe, so anything after it is silently dropped rather than reported.
 *
 * Validated against a live instance over 26 argument shapes, comparing both the accept/reject
 * verdict and the resulting value: 0 false approvals, 0 false blocks, 0 value mismatches.
 * Three simpler models were discarded, each by a counterexample — quote parity admits
 * `'{ "k" : "a' 'b" }'` which fails; full-consumption admits `"{'k':'v'}"` which is not JSON;
 * unescaping every `\x` rejects `'{"k":"say \"hi\""}'` which works.
 */

/** End index of the literal opening at `start`, or -1 when it is unterminated. */
function literalEnd(markup: string, start: number): number {
  const quote = markup[start];
  let i = start + 1;
  while (i < markup.length) {
    if (markup[i] === '\\') {
      i += 2;
      continue;
    }
    if (markup[i] === quote) return i + 1;
    i += 1;
  }
  return -1;
}

/** The first `QuotedFragment+` run — what `Base::SYNTAX` captures as the value. */
function firstRun(markup: string): string {
  let i = 0;
  while (i < markup.length) {
    const char = markup[i];
    if (char === "'" || char === '"') {
      const end = literalEnd(markup, i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === ',' ||
      char === '|'
    )
      break;
    i += 1;
  }
  return markup.slice(0, i);
}

/**
 * The value the tag receives, or `undefined` when the markup yields none.
 *
 * A run wrapped in matching delimiters is a string literal, so only the OUTER pair is
 * removed. Only the delimiter and backslash are unescaped: a `\"` inside a `'…'` literal is
 * not an escape and must survive, which is what lets `'{"k":"say \"hi\""}'` reach a JSON
 * parser intact.
 */
export function baseTagValue(markup: string): string | undefined {
  const run = firstRun(markup.trim());
  if (run.length === 0) return undefined;

  const quote = run[0];
  const isLiteral = (quote === "'" || quote === '"') && run.length >= 2 && run.endsWith(quote);
  if (!isLiteral) return run;

  const inner = run.slice(1, -1);
  return inner.replace(quote === "'" ? /\\(['\\])/g : /\\(["\\])/g, '$1');
}
