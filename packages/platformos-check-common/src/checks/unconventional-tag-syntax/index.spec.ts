import { describe, expect, it } from 'vitest';
import { UnconventionalTagSyntax } from '.';
import { LiquidHTMLSyntaxError } from '../liquid-html-syntax-error';
import { runLiquidCheck } from '../../test';
import { Severity } from '../../types';

/**
 * Both halves of the split live here on purpose. The risk is not that this check fails to
 * fire; it is that it fires too widely, because several spellings the platform also accepts
 * are silently WRONG, and demoting one turns a refused write into a shipped defect.
 *
 * Every row's platform behaviour was rendered on a live instance (round ROUND-2026-08-26).
 */

/** Warned about, never blocked. */
const TOLERATED = [
  { what: 'capture, single-quoted target', source: `{% capture 'cs' %}HI{% endcapture %}` },
  { what: 'capture, double-quoted target', source: `{% capture "cs" %}HI{% endcapture %}` },
  { what: 'capture, hyphen in the quoted name', source: `{% capture 'a-b' %}HI{% endcapture %}` },
  { what: 'case, trailing colon', source: `{% case g: %}{% when 1 %}ONE{% endcase %}` },
  { what: 'case, dotted path then colon', source: `{% case g.type: %}{% when 1 %}A{% endcase %}` },
  { what: 'case, space before the colon', source: `{% case g : %}{% when 1 %}ONE{% endcase %}` },
  { what: 'case, double colon', source: `{% case g:: %}{% when 1 %}ONE{% endcase %}` },
  { what: 'parse_json, stray percent', source: `{% parse_json d %%}{"k":2}{% endparse_json %}` },
  {
    what: 'parse_json, several percents',
    source: `{% parse_json d %%%}{"k":2}{% endparse_json %}`,
  },
  // Prettier normalises `%%}` to `% %}`; both leave markup `d %`, so a save must not turn a
  // warning into a blocked write.
  {
    what: 'parse_json, as prettier reprints it',
    source: `{% parse_json d % %}{"k":2}{% endparse_json %}`,
  },

  // response_headers: admitted when the value the tag RECEIVES parses as a JSON object.
  // Every row below was rendered on the instance and its header value read back.
  {
    what: 'response_headers, one nested pair (the corpus construct)',
    source: `{% response_headers '{ "Content-Security-Policy" : "frame-ancestors 'none'" }' %}`,
  },
  {
    what: 'response_headers, two nested pairs',
    source: `{% response_headers '{ "X-Ae" : "a 'b' c 'd' e" }' %}`,
  },
  {
    what: 'response_headers, nested pair with nothing around it',
    source: `{% response_headers '{ "X-Ae" : "'x'" }' %}`,
  },
  {
    what: 'response_headers, adjacent empty pair',
    source: `{% response_headers '{"X-Ae":"''"}' %}`,
  },
  {
    // Escaped delimiter alongside an unescaped one, so the grammar leaves raw markup AND the
    // unescape matters: without it the value holds `\\'`, an invalid JSON escape, and a
    // working construct would be blocked. Measured: header `a 'b`.
    what: 'response_headers, escaped delimiter beside an unescaped one',
    source: `{% response_headers '{ "X-Ae" : "a \\'b" }' %}`,
  },
  {
    // Measured: header `it's 'q' ok`.
    what: 'response_headers, escaped and unescaped delimiters mixed',
    source: `{% response_headers '{"X-Ae":"it\\'s 'q' ok"}' %}`,
  },
  {
    // The run ends at the space, so ` extra` is dropped — but what the tag receives is still
    // valid JSON, and the platform sets the header. Admitted for that reason, not by accident.
    what: 'response_headers, a dropped tail that leaves valid JSON behind',
    source: `{% response_headers '{"X-Ae":"x"}' extra %}`,
  },
];

/**
 * Must keep blocking. Three reasons appear below, and they are NOT interchangeable:
 *
 *   RAISES     the platform refuses it.
 *   WRONG      it runs and does something other than what was written — the dangerous class.
 *   NOT ADMITTED  it runs correctly, and is still refused. The allowlist is deliberately
 *                 minimal: a shape earns a place by occurring in real code, not merely by
 *                 working. Each of these is a knowingly-accepted false block on a construct
 *                 with zero corpus occurrences; widen with data, not with sympathy.
 */
const MUST_STILL_BLOCK = [
  {
    what: 'WRONG: cache with a leading colon — the key collapses to ":" and is shared instance-wide',
    source: `{% cache: k, expire: 30 %}BODY{% endcache %}`,
  },
  {
    what: 'WRONG: cache with the key omitted — collapses to "expire:", with no leading separator',
    source: `{% cache expire: 30 %}BODY{% endcache %}`,
  },
  {
    what: 'WRONG: log with a leading colon — the message becomes ":" and the payload is lost',
    source: `{% log: o, type: 'E' %}`,
  },
  {
    // Measured HTTP 501: the run ends at the unescaped quote inside `va'lue`, so the tag gets
    // `{"X-Ae": "va` — not valid JSON. Quote PARITY would admit this class; JSON validity does
    // not, which is why the predicate is semantic rather than syntactic.
    what: 'WRONG: response_headers whose unbalanced apostrophe truncates the JSON',
    source: `{% response_headers '{"X-Ae": "va'lue"}' %}`,
  },
  {
    // Measured HTTP 501. EVEN number of quotes, and still broken — the counterexample that
    // killed the quote-parity predicate.
    what: 'WRONG: response_headers with an even quote count that still truncates',
    source: `{% response_headers '{ "X-Ae" : "a' 'b" }' %}`,
  },
  {
    // Measured HTTP 501: raw markup, and the extracted value IS valid JSON — but an array is
    // not a header map. This is what makes the object check load-bearing rather than defensive.
    what: 'WRONG: response_headers whose value is a valid JSON array',
    source: `{% response_headers '[{"k":"a 'b' c"}]' %}`,
  },
  {
    what: 'RAISES: capture with empty markup',
    source: `{% capture %}x{% endcapture %}`,
  },
  {
    // Measured: `[a=HI][b=]` — it captures into `a` and silently drops ` b`.
    what: 'WRONG: capture with a space inside the quotes captures into `a` and drops the rest',
    source: `{% capture 'a b' %}x{% endcapture %}`,
  },
  {
    // Measured: `[cs=HI][extra=]` — it captures into `cs`. Which token was meant is unknowable.
    what: 'WRONG: capture with a trailing token — the second token is silently dropped',
    source: `{% capture 'cs' extra %}x{% endcapture %}`,
  },
  {
    // Measured with a readable name (`'1x'`): it captures into `1x` and works. An all-digit
    // name cannot be read back at all — `{{ 123 }}` is a numeric literal, not a lookup — so
    // the earlier "unmeasured" note was replaced by this, not by an admission.
    what: 'NOT ADMITTED: capture with a digit-leading quoted name, which runs correctly',
    source: `{% capture '123' %}x{% endcapture %}`,
  },
  {
    // Measured: renders the `else` branch. VariableLookup gets a nil name, so every `when`
    // misses and control falls through with no error. The dangerous case in this family.
    what: 'WRONG: case with a colon and no name silently takes the else branch',
    source: `{% case : %}{% when 1 %}ONE{% endcase %}`,
  },
  {
    // Measured: takes the correct branch. Refused only because nothing writes it.
    what: 'NOT ADMITTED: case with a colon then another token, which runs correctly',
    source: `{% case g : : %}{% when 1 %}ONE{% endcase %}`,
  },
  {
    what: 'RAISES: parse_json with a percent and no name',
    source: `{% parse_json %%}{"k":2}{% endparse_json %}`,
  },
];

/** Well-formed markup: the grammar parses it, so neither check may speak. */
const WELL_FORMED = [
  `{% capture cs %}HI{% endcapture %}`,
  `{% case g %}{% when 1 %}ONE{% endcase %}`,
  `{% parse_json d %}{"k":2}{% endparse_json %}`,
  `{% cache 'k', expire: 30 %}BODY{% endcache %}`,
  `{% log o, type: 'E' %}`,
  `{% response_headers '{"X-Ae":"plain"}' %}`,
  `{% response_headers '{"X-Ae":"say \\"hi\\""}' %}`,
];

/**
 * Arguments the GRAMMAR parses, so neither check runs — and the platform still refuses them
 * with HTTP 501. A pre-existing false approval, unrelated to this check and unaffected by it:
 * these never had raw markup, so the split cannot reach them. Pinned so the gap stays visible
 * rather than implicit; tracked separately.
 */
const KNOWN_UNCHECKED_BY_ANY_CHECK = [
  { what: 'single-quoted JSON keys', source: `{% response_headers "{'X-Ae':'plain'}" %}` },
  { what: 'a JSON array, not an object', source: `{% response_headers '[1,2]' %}` },
  { what: 'not JSON at all', source: `{% response_headers 'not json' %}` },
];

async function bothChecks(source: string) {
  return {
    unconventional: await runLiquidCheck(UnconventionalTagSyntax, source),
    invalidTagSyntax: (await runLiquidCheck(LiquidHTMLSyntaxError, source)).filter((o) =>
      /Invalid syntax for tag/.test(o.message),
    ),
  };
}

describe('UnconventionalTagSyntax', () => {
  describe('demotes the measured-safe spellings', () => {
    for (const { what, source } of TOLERATED) {
      it(`warns, and nothing blocks: ${what}`, async () => {
        const { unconventional, invalidTagSyntax } = await bothChecks(source);
        expect(unconventional).toHaveLength(1);
        expect(unconventional[0].check).toBe('UnconventionalTagSyntax');
        expect(unconventional[0].severity).toBe(Severity.WARNING);
        expect(invalidTagSyntax).toEqual([]);
      });
    }
  });

  describe('leaves the dangerous spellings blocking', () => {
    for (const { what, source } of MUST_STILL_BLOCK) {
      it(`still an error, and not demoted: ${what}`, async () => {
        const { unconventional, invalidTagSyntax } = await bothChecks(source);
        expect(unconventional).toEqual([]);
        expect(invalidTagSyntax.length).toBeGreaterThan(0);
        expect(invalidTagSyntax.every((o) => o.severity === Severity.ERROR)).toBe(true);
      });
    }
  });

  describe('says nothing about well-formed markup', () => {
    for (const source of WELL_FORMED) {
      it(`silent: ${source}`, async () => {
        const { unconventional, invalidTagSyntax } = await bothChecks(source);
        expect(unconventional).toEqual([]);
        expect(invalidTagSyntax).toEqual([]);
      });
    }
  });

  it('never fires on the same construct as the blocking check', async () => {
    for (const { source } of [...TOLERATED, ...MUST_STILL_BLOCK]) {
      const { unconventional, invalidTagSyntax } = await bothChecks(source);
      expect(
        unconventional.length > 0 && invalidTagSyntax.length > 0,
        `both fired on ${source}`,
      ).toBe(false);
    }
  });

  it('covers every tag in the allowlist, so a tag cannot be added without a fixture', async () => {
    const covered = new Set<string>();
    for (const { source } of TOLERATED) {
      const [offense] = await runLiquidCheck(UnconventionalTagSyntax, source);
      covered.add(/\{%\s*([a-z_]+)/.exec(offense.message.replace(/^`/, ''))?.[1] ?? '');
    }
    expect([...covered].sort()).toEqual(['capture', 'case', 'parse_json', 'response_headers']);
  });

  describe('is silent where the grammar already parsed the markup', () => {
    it.each(KNOWN_UNCHECKED_BY_ANY_CHECK)('$what', async ({ source }) => {
      const { unconventional, invalidTagSyntax } = await bothChecks(source);
      expect(unconventional).toEqual([]);
      expect(invalidTagSyntax).toEqual([]);
    });
  });

  it('does not report inside {% raw %}, whose body the parser keeps as text', async () => {
    const { unconventional } = await bothChecks(
      `{% raw %}{% capture 'cs' %}HI{% endcapture %}{% endraw %}`,
    );
    expect(unconventional).toEqual([]);
  });

  /**
   * TASK-80: the same malformed statement can reach different verdicts as a tag and inside a
   * `{% liquid %}` body, and `assign` still does. A demoted spelling must not join that list —
   * an author moving working code into a liquid block would otherwise gain a blocking error.
   */
  describe('reaches the same verdict inside a {% liquid %} body', () => {
    it.each([
      {
        what: 'capture',
        tag: `{% capture 'cs' %}X{% endcapture %}`,
        liquid: `{% liquid\n  capture 'cs'\n    echo 'X'\n  endcapture\n%}`,
      },
      {
        what: 'case',
        tag: `{% case g: %}{% when 1 %}A{% endcase %}`,
        liquid: `{% liquid\n  case g:\n    when 1\n      echo 'A'\n  endcase\n%}`,
      },
    ])('$what', async ({ tag, liquid }) => {
      const asTag = await bothChecks(tag);
      const inBody = await bothChecks(liquid);
      expect(asTag.unconventional).toHaveLength(1);
      expect(inBody.unconventional).toHaveLength(1);
      expect(asTag.invalidTagSyntax).toEqual([]);
      expect(inBody.invalidTagSyntax).toEqual([]);
    });
  });
});
