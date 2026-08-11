import { expect, describe, it, vi } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { applyFix, autofix, highlightedOffenses, messagesOf, runLiquidCheck } from '../../test';
import { PlatformOSDocset, TagEntry } from '../../types/platformos-liquid-docs';
import { DeprecatedTag, deprecationReplacementTag } from './index';

// Spy on the real parser so "which sources were parsed?" is observable, which is how the memo
// at the bottom of this file is asserted. Everything about the parser stays real. `vi.mock` is
// hoisted above the imports, so both this module and the check see the spied export.
vi.mock('@platformos/liquid-html-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/liquid-html-parser')>();
  return { ...actual, toLiquidHtmlAST: vi.fn(actual.toLiquidHtmlAST) };
});

/**
 * EVERY TAG NAMED HERE IS A REAL platformOS TAG, and every `deprecation_reason` is the one
 * the live docset carries, verbatim (`platformos-check-docs-updater/data/tags.json`, which
 * that package's `postbuild` re-downloads from production). An invented tag name or a
 * convenient paraphrase would be testing a mapping production never has — and would read, to
 * the next person, as a tag this platform has.
 *
 * NO ENTRY CARRIES `deprecation_replacement`, on purpose: this docset is the OLD shape, from
 * before the platform published the successor as data, so these cases exercise the prose
 * fallback. The new shape is `docsetStating` below.
 *
 * Two entries are the current docset with ONE field changed, and each says so: the change is
 * the case under test, and the names around it stay real. What the committed docset actually
 * says is asserted whole in `platformos-check-node/src/autofix.spec.ts`.
 *
 * The list is a SUBSET of the docset — `sign_in` is deliberately missing — which is itself
 * one of the cases below.
 */
const mockDependencies: { platformosDocset: PlatformOSDocset } = {
  platformosDocset: {
    async graphQL() {
      return null;
    },
    async filters() {
      return [];
    },
    async objects() {
      return [];
    },
    async liquidDrops() {
      return [];
    },
    async tags() {
      return [
        {
          name: 'hash_assign',
          deprecated: true,
          deprecation_reason:
            'Use {% assign %} tag instead, which now supports hash assignment syntax',
        },
        { name: 'assign' },
        // A block tag, so its `end` tag has to be renamed too.
        { name: 'try_rc', deprecated: true, deprecation_reason: 'Use {% try %} instead.' },
        { name: 'try' },
        // The replacement's markup rule ACCEPTS what this tag's did not parse at all.
        {
          name: 'render_form',
          deprecated: true,
          deprecation_reason: 'Use {% include_form %} instead.',
        },
        { name: 'include_form' },
        // The replacement takes an entirely different markup shape (`graphql g = "path"`).
        {
          name: 'execute_query',
          deprecated: true,
          deprecation_reason: 'Use {% graphql %} instead.',
        },
        { name: 'graphql' },
        // Points at `sign_in`, which this list does not carry — the docset's own reason, read
        // against a docset that has not heard of the tag it names.
        {
          name: 'sign_in_rc',
          deprecated: true,
          deprecation_reason: 'Use {% sign_in %} instead.',
        },
        // CHANGED FROM THE DOCSET: `query_graph`'s reason names `graphql`. Pointed at
        // `execute_query` instead, it is an alias chain whose target is on its way out too —
        // the shape a docset lands in when one alias is retired in favour of another.
        {
          name: 'query_graph',
          deprecated: true,
          deprecation_reason: 'Use {% execute_query %} instead.',
        },
        // `parse_json` carries `deprecated: false` in the docset committed today, and this
        // reason verbatim in ~/projects/desksnearme, whose `parse_json_tag.rb` does annotate
        // it `@deprecated` — the committed copy simply predates that. Deprecated here because
        // upstream says so and because it is the shape of the case: a BLOCK tag whose
        // migration, `{% assign x = { … } %}`, moves the body into the markup, so renaming it
        // would be a rewrite that drops the author's JSON.
        {
          name: 'parse_json',
          deprecated: true,
          deprecation_reason: 'Use {% assign %} tag instead, which now supports JSON literals',
        },
        // CHANGED FROM THE DOCSET: `context_rc` has a reason there. Stripped of it here,
        // because a docset entry with nothing to derive a replacement from is a state this
        // check has to survive.
        { name: 'context_rc', deprecated: true },
        { name: 'render' },
      ];
    },
  },
};

/**
 * The docset above with one tag's entry amended — a rephrased `deprecation_reason`, or a
 * `deprecation_replacement` the committed docset does not carry yet.
 *
 * What it is used to ask is what happens when the docs say something they do not say TODAY,
 * so the tag names stay real and only the field under test is hypothetical.
 */
function docsetWhere(name: string, fields: Partial<TagEntry>) {
  return {
    platformosDocset: {
      ...mockDependencies.platformosDocset,
      async tags(): Promise<TagEntry[]> {
        return (await mockDependencies.platformosDocset.tags()).map((tag) =>
          tag.name === name ? { ...tag, deprecated: true, ...fields } : tag,
        );
      },
    },
  };
}

const FILE = 'app/views/partials/file.liquid';
const HASH_ASSIGN_REASON =
  "Deprecated tag 'hash_assign': Use {% assign %} tag instead, which now supports hash assignment syntax";

async function offensesFor(sourceCode: string) {
  return runLiquidCheck(DeprecatedTag, sourceCode, FILE, mockDependencies);
}

async function singleOffenseFor(
  sourceCode: string,
  deps: typeof mockDependencies = mockDependencies,
) {
  const offenses = await runLiquidCheck(DeprecatedTag, sourceCode, FILE, deps);
  expect(offenses).toHaveLength(1);
  return offenses[0];
}

/** The source after the one offense's fix, or unchanged when it offers none. */
async function fixed(sourceCode: string, deps?: typeof mockDependencies) {
  return applyFix(sourceCode, await singleOffenseFor(sourceCode, deps));
}

describe('Module: DeprecatedTag', () => {
  it('should report a deprecated tag, highlighting the NAME and not the whole tag', async () => {
    const sourceCode = `{% hash_assign foo['bar'] = 'baz' %}`;

    const offenses = await offensesFor(sourceCode);

    expect(messagesOf(offenses)).toEqual([HASH_ASSIGN_REASON]);
    expect(highlightedOffenses(sourceCode, offenses)).toEqual(['hash_assign']);
  });

  it('should not report an offense when a non-deprecated tag is used', async () => {
    const offenses = await offensesFor(`{% render 'templates/foo.liquid' %}`);

    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should report multiple offenses when multiple deprecated tags are used', async () => {
    const sourceCode = [
      `{% hash_assign foo['bar'] = 'baz' %}`,
      `{% assign greeting = "hello world" %}`,
      `{% hash_assign foo['qux'] = 'quux' %}`,
    ].join('\n');

    const offenses = await offensesFor(sourceCode);

    expect(messagesOf(offenses)).toEqual([HASH_ASSIGN_REASON, HASH_ASSIGN_REASON]);
    expect(highlightedOffenses(sourceCode, offenses)).toEqual(['hash_assign', 'hash_assign']);
  });

  /**
   * The rename is derived from the docset, never from a table in the check: the replacement
   * comes out of `deprecation_reason` and the parser decides whether it accepts the markup.
   * So these cases are about the RULE — no assertion here is specific to a tag pair beyond
   * naming one that exercises the branch.
   */
  describe('autofix: rename to the replacement the docset names', () => {
    it('replaces the tag name and nothing else', async () => {
      expect(await fixed(`{% hash_assign foo['bar'] = 'baz' %}`)).toEqual(
        `{% assign foo['bar'] = 'baz' %}`,
      );
    });

    it('keeps whitespace control, which sits outside the replaced span', async () => {
      expect(await fixed(`{%- hash_assign foo['bar'] = 'baz' -%}`)).toEqual(
        `{%- assign foo['bar'] = 'baz' -%}`,
      );
    });

    it('rewrites a tag inside a {% liquid %} block, where the tag has no delimiters', async () => {
      expect(
        await fixed(
          ['{% liquid', "  hash_assign foo['bar'] = 'baz'", '  echo foo', '%}'].join('\n'),
        ),
      ).toEqual(['{% liquid', "  assign foo['bar'] = 'baz'", '  echo foo', '%}'].join('\n'));
    });

    it('renames BOTH ends of a block tag, which is unparseable if only one moves', async () => {
      expect(await fixed(`{% try_rc %}body{% endtry_rc %}`)).toEqual(`{% try %}body{% endtry %}`);
    });

    it('renames when the replacement parses markup the deprecated tag never did', async () => {
      // `render_form` has no strict markup rule, so its markup is a raw string; `include_form`
      // does have one and accepts it. The rule is "the REPLACEMENT accepts it", not "both do".
      expect(await fixed(`{% render_form 'path/to/form' %}`)).toEqual(
        `{% include_form 'path/to/form' %}`,
      );
    });

    /**
     * A DOT TARGET IS RENAMED, and this test exists because the opposite was believed and
     * written down. `InvalidHashAssignTargetSyntax` used to claim that `{% assign h.a.b = v %}`
     * writes a key literally named `a.b`, so renaming a dot-target `hash_assign` would silently
     * change what the template means. Re-measured with `pos-cli exec liquid dev`, reading the
     * hash back:
     *
     *   {% assign h = {"a": {"b": "old"}} %}{% assign h.a.b = 'NEW' %}    -> {"a":{"b":"NEW"}}
     *   {% assign h = {"a": {"b": "old"}} %}{% assign h['a'].b = 'NEW' %} -> {"a":{"b":"NEW"}}
     *   {% assign h = {"a": {"b":"old"}} %}{% hash_assign h.a.b = 'NEW' %} -> RAISES
     *
     * A dot is a path separator for `assign`, exactly as a bracket is, and `hash_assign` does
     * not accept one at all — so the rename turns undeployable code into code that does what
     * the author meant. It is a strict improvement and must NOT be guarded against. The comment
     * that said otherwise is corrected; this is the part of that correction that can fail.
     */
    it('renames a dot-target hash_assign, which the disproven comment argued against', async () => {
      expect(await fixed(`{% hash_assign h.a.b = 'NEW' %}`)).toEqual(`{% assign h.a.b = 'NEW' %}`);
    });

    it('rewrites every occurrence in one autofix pass', async () => {
      const sourceCode = [
        `{% hash_assign foo['bar'] = 'baz' %}`,
        `{% assign greeting = "hello world" %}`,
        `{% hash_assign foo['qux'] = 'quux' %}`,
      ].join('\n');
      const offenses = await offensesFor(sourceCode);

      expect(await autofix({ [FILE]: sourceCode }, offenses)).toEqual({
        [FILE]: [
          `{% assign foo['bar'] = 'baz' %}`,
          `{% assign greeting = "hello world" %}`,
          `{% assign foo['qux'] = 'quux' %}`,
        ].join('\n'),
      });
    });
  });

  /**
   * Each case must stay UNFIXED, and each asserts that the offense is still REPORTED — a
   * check that quietly stopped firing would satisfy a bare "no fix" assertion just as well as
   * the guard that is supposed to be doing the work.
   */
  describe('offenses that must be reported without a fix', () => {
    async function unfixed(sourceCode: string, message: string) {
      const offense = await singleOffenseFor(sourceCode);

      expect(offense.message).toEqual(message);
      expect(offense.fix).toBeUndefined();
      expect(applyFix(sourceCode, offense)).toEqual(sourceCode);
    }

    it('declines when the replacement tag rejects the markup', async () => {
      // `{% graphql 'q', result_name: 'g' %}` is not valid `graphql` markup — that tag wants
      // `graphql g = "path/to/query"`. Renaming would produce a template the platform cannot
      // parse, which is exactly what the parser probe is there to catch.
      await unfixed(
        `{% execute_query 'q', result_name: 'g' %}`,
        `Deprecated tag 'execute_query': Use {% graphql %} instead.`,
      );
    });

    it('declines when the markup does not parse under the replacement either', async () => {
      await unfixed(`{% hash_assign foo %}`, HASH_ASSIGN_REASON);
    });

    it('declines when the named replacement is not a tag this docset knows', async () => {
      await unfixed(
        `{% sign_in_rc user_id: 1 %}`,
        `Deprecated tag 'sign_in_rc': Use {% sign_in %} instead.`,
      );
    });

    it('declines when the named replacement is itself deprecated', async () => {
      await unfixed(
        `{% query_graph 'q', result_name: 'g' %}`,
        `Deprecated tag 'query_graph': Use {% execute_query %} instead.`,
      );
    });

    it('declines when there is no deprecation_reason to derive a replacement from', async () => {
      await unfixed(`{% context_rc language: 'en' %}`, `Deprecated tag 'context_rc'.`);
    });

    /**
     * `{% parse_json car %}{ … }{% endparse_json %}` migrates to
     * `{% assign car = { … } %}`: the BODY becomes part of the markup. Renaming the tag
     * would leave `{% assign car %}{ … }{% endassign %}`, which is not the same program and
     * loses the author's JSON — so this must be reported and never fixed, even though the
     * reason names a perfectly good replacement.
     */
    it('declines a block tag whose replacement is not a block tag', async () => {
      await unfixed(
        `{% parse_json car %}{"type":"SUV"}{% endparse_json %}`,
        `Deprecated tag 'parse_json': Use {% assign %} tag instead, which now supports JSON literals`,
      );
    });

    it('declines that same block tag when it carries no markup to judge it by', async () => {
      // `{% parse_json %}` has EMPTY markup, and "nothing to carry over" is otherwise the
      // one condition that accepts a rename outright. Block-ness is what refuses it here.
      await unfixed(
        `{% parse_json %}{"type":"SUV"}{% endparse_json %}`,
        `Deprecated tag 'parse_json': Use {% assign %} tag instead, which now supports JSON literals`,
      );
    });
  });

  /**
   * The replacement is read from an ANCHORED form — a reason OPENS with `Use {% x %}` — not
   * from whichever tag the prose mentions first. Every reason the docset ships today satisfies
   * both rules, so the two diverge only on phrasings the docs have not written yet; these are
   * about what happens when they do.
   *
   * Reasons rather than tags, because the reason is the whole input: no tag has to be invented
   * to ask the question, and none is.
   */
  describe('deprecationReplacementTag: which tag a reason names', () => {
    it('reads the tag the reason opens with', () => {
      expect(deprecationReplacementTag('Use {% include_form %} instead.')).toEqual('include_form');
    });

    it('reads it through whitespace control, which is delimiter syntax and not a name', () => {
      expect(deprecationReplacementTag('Use {%- assign -%} instead.')).toEqual('assign');
    });

    it('names nothing when the reason opens by naming the deprecated tag', () => {
      expect(
        deprecationReplacementTag('{% render_form %} is deprecated; use {% include_form %}.'),
      ).toBeUndefined();
    });

    it('names nothing when the reason opens by naming some other tag', () => {
      expect(
        deprecationReplacementTag(
          'Deprecated because {% assign %} supersedes it; use {% include_form %}.',
        ),
      ).toBeUndefined();
    });

    it('names nothing for a reason that is absent, empty or plain prose', () => {
      expect([
        deprecationReplacementTag(undefined),
        deprecationReplacementTag(''),
        deprecationReplacementTag('This tag has been retired.'),
      ]).toEqual([undefined, undefined, undefined]);
    });
  });

  /**
   * What that rule is FOR. A reason naming a working tag before it names the successor is not
   * merely a lost fix: the first-mention rule derives `assign`, whose grammar accepts this
   * markup, so the check would rewrite the tag to one the docs never recommended — unattended,
   * since `pos-cli check run -a` writes to disk. The offense is reported either way, so the
   * fix is the only place the difference is visible.
   */
  it('never renames to a tag the reason mentions but does not recommend', async () => {
    const sourceCode = `{% render_form foo['bar'] = 'baz' %}`;
    const reason = 'Deprecated because {% assign %} supersedes it; use {% include_form %}.';

    const offenses = await runLiquidCheck(
      DeprecatedTag,
      sourceCode,
      FILE,
      docsetWhere('render_form', { deprecation_reason: reason }),
    );

    expect(messagesOf(offenses)).toEqual([`Deprecated tag 'render_form': ${reason}`]);
    expect(applyFix(sourceCode, offenses[0])).toEqual(sourceCode);
  });

  /**
   * The platform states the successor as DATA now — `deprecation_replacement`, from
   * `@alias`/`@replaced_by` in ~/projects/desksnearme — so the prose above is a fallback for
   * docsets published before it did, not the contract.
   *
   * The two are separated here by making them DISAGREE, which no real docset does: a reason
   * naming one tag and the field naming another. Nothing else can tell which one a rename came
   * from, since agreeing sources produce the same output whichever is read.
   */
  describe('the successor the docset states, not the one its prose names', () => {
    // Markup `include_form` accepts and `assign` does not, so the two sources produce
    // visibly different outcomes rather than the same rename by two routes.
    const source = `{% hash_assign 'path/to/form' %}`;

    it('renames to the stated successor even where the reason names another tag', async () => {
      // `hash_assign`'s reason says `assign`; the field says `include_form`.
      expect(
        await fixed(
          source,
          docsetWhere('hash_assign', { deprecation_replacement: 'include_form' }),
        ),
      ).toEqual(`{% include_form 'path/to/form' %}`);
    });

    it('falls back to the reason for a docset that states nothing', async () => {
      // Same tag, same source, field absent — `mockDependencies` is the old shape — so the
      // reason's `assign` is consulted, rejects this markup, and nothing is renamed. The
      // control for the assertion above rather than a second reading of it.
      expect(await fixed(source)).toEqual(source);
    });

    it('ignores a stated successor this docset does not know, rather than renaming to it', async () => {
      // The guard that matters most: the field is data from another repo, and a name this
      // docset has never heard of must not be written into the user's file.
      const sourceCode = `{% hash_assign foo['bar'] = 'baz' %}`;

      expect(
        await fixed(sourceCode, docsetWhere('hash_assign', { deprecation_replacement: 'assgin' })),
      ).toEqual(sourceCode);
    });
  });

  /**
   * The probe that decides whether a replacement accepts an occurrence's markup is one
   * parse, and it runs per OCCURRENCE. It is memoized on exactly what the answer depends on
   * — `(replacement, block-ness, markup text)` — so a repeated markup, and a repeated lint of
   * an unchanged buffer, re-parse nothing.
   *
   * Counted rather than timed, and paired with a control that MUST still probe twice: a memo
   * wide enough to answer with another markup's verdict would satisfy any "only one parse"
   * assertion on its own.
   */
  describe('the grammar probe is memoized per (replacement, block-ness, markup)', () => {
    async function probesWhileChecking(sourceCode: string): Promise<string[]> {
      vi.mocked(toLiquidHtmlAST).mockClear();
      await offensesFor(sourceCode);
      // Only the reconstructed one-tag probes; the file under test is parsed too.
      return vi
        .mocked(toLiquidHtmlAST)
        .mock.calls.map(([source]) => source)
        .filter((source) => source.startsWith('{% assign '));
    }

    it('probes once for two occurrences with the same markup', async () => {
      const repeated = `{% hash_assign memo['same'] = 'baz' %}`;

      expect(await probesWhileChecking([repeated, repeated].join('\n'))).toEqual([
        `{% assign memo['same'] = 'baz' %}`,
      ]);
    });

    it('probes again for a markup it has not seen, so the memo is not answering blind', async () => {
      const source = [
        `{% hash_assign memo['one'] = 'baz' %}`,
        `{% hash_assign memo['two'] = 'quux' %}`,
      ].join('\n');

      expect(await probesWhileChecking(source)).toEqual([
        `{% assign memo['one'] = 'baz' %}`,
        `{% assign memo['two'] = 'quux' %}`,
      ]);
    });

    it('re-probes nothing when the same source is checked again', async () => {
      const sourceCode = `{% hash_assign memo['again'] = 1 %}`;
      await offensesFor(sourceCode);

      expect(await probesWhileChecking(sourceCode)).toEqual([]);
    });
  });
});
