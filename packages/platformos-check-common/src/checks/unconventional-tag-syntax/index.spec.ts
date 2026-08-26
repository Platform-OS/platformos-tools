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
];

/** Must keep blocking: each either raises on the platform, or runs while doing the wrong thing. */
const MUST_STILL_BLOCK = [
  {
    what: 'cache with a leading colon — key collapses to ":" and is shared instance-wide',
    source: `{% cache: k, expire: 30 %}BODY{% endcache %}`,
  },
  {
    what: 'cache with the key omitted — collapses to "expire:" with no leading separator',
    source: `{% cache expire: 30 %}BODY{% endcache %}`,
  },
  { what: 'log with a leading colon — the message becomes ":"', source: `{% log: o, type: 'E' %}` },
  {
    what: 'response_headers whose nested quotes truncate the argument',
    source: `{% response_headers '{ "CSP" : "frame-ancestors 'none'" }' %}`,
  },
  {
    what: 'capture with empty markup — the platform raises',
    source: `{% capture %}x{% endcapture %}`,
  },
  {
    what: 'capture with a space inside the quotes — the regex would take only `a`',
    source: `{% capture 'a b' %}x{% endcapture %}`,
  },
  {
    what: 'capture with a trailing token — which of the two is the target is ambiguous',
    source: `{% capture 'cs' extra %}x{% endcapture %}`,
  },
  {
    what: 'capture with a digit-leading quoted name — unmeasured, so not admitted',
    source: `{% capture '123' %}x{% endcapture %}`,
  },
  {
    what: 'case with a colon and no name — looks up nil, every when misses',
    source: `{% case : %}{% when 1 %}ONE{% endcase %}`,
  },
  {
    what: 'case with a colon then another token',
    source: `{% case g : : %}{% when 1 %}ONE{% endcase %}`,
  },
  {
    what: 'parse_json with a percent and no name — the platform raises',
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
    expect([...covered].sort()).toEqual(['capture', 'case', 'parse_json']);
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
