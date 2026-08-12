import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { describe, it, expect } from 'vitest';
import { applyFix, messagesOf, runLiquidCheck } from '../../../test';
import { FilterEntry } from '../../../types';
import { LiquidHTMLSyntaxError } from '../index';

/**
 * The message and the FIXED SOURCE are asserted whole, both of them.
 *
 * They used to be asserted by substring — `message).toContain("has trailing characters")`,
 * `fix).toBeDefined()`, `fixedCode).toContain('append')` — and that is not a weaker version
 * of the same test, it is a different and much smaller claim. Measured: with the corrector
 * changed to emit `' | CORRUPTED'` instead of `''`, 13 of this file's 20 tests stayed green,
 * including the one named "should detect and fix append with trailing @ character", because
 * `{{ 'HELLO' | append | CORRUPTED }}` does contain `append` and does not contain `append@`.
 */
const trailing = (filter: string, characters: string) =>
  `Syntax is not supported Filter '${filter}' has trailing characters '${characters}' that should be removed.`;

/** The offense messages, and the source each offense's own fix produces. */
async function report(sourceCode: string) {
  const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, sourceCode);

  return {
    messages: messagesOf(offenses),
    fixes: offenses.map((offense) => applyFix(sourceCode, offense)),
  };
}

describe('Module: InvalidFilterName', () => {
  describe('Filters this check must leave alone', () => {
    it('should not report a filter name whose trailing characters are part of the name', async () => {
      const alphanumeric = await report(`{{ 'HELLO' | append123: 'world' }}`);
      const underscore = await report(`{{ 'HELLO' | append_test }}`);
      // The control: the same shape with a character that is NOT part of a name.
      const invalid = await report(`{{ 'HELLO' | append@ }}`);

      expect({
        alphanumeric: alphanumeric.messages,
        underscore: underscore.messages,
        invalid: invalid.messages,
      }).toEqual({
        alphanumeric: [],
        underscore: [],
        invalid: [trailing('append', '@')],
      });
    });

    it('should not report a valid filter, known or unknown to the docset', async () => {
      // An unknown filter name is `UnknownFilter`'s business; this check is about SYNTAX.
      const known = await report(`{{ 'hello' | append: 'world' }}`);
      const unknown = await report(`{{ 'hello' | completely_unknown_filter: 'world' }}`);

      expect({ known: known.messages, unknown: unknown.messages }).toEqual({
        known: [],
        unknown: [],
      });
    });
  });

  describe('Output tags', () => {
    it('should report and fix a special character after the filter name', async () => {
      expect(await report(`{{ 'HELLO' | append@ }}`)).toEqual({
        messages: [trailing('append', '@')],
        fixes: [`{{ 'HELLO' | append }}`],
      });
    });

    it('should report and fix a space followed by characters', async () => {
      expect(await report(`{{ 'HELLO' | append me: 'world' }}`)).toEqual({
        messages: [trailing('append', ' me')],
        fixes: [`{{ 'HELLO' | append: 'world' }}`],
      });
    });
  });

  describe('Filter combinations and chains', () => {
    it('should fix the offending filter and leave the valid one either side of it', async () => {
      const after = await report(`{{ 'test' | downcase | append@: 'world' }}`);
      const before = await report(`{{ 'test' | append!: 'hello' | upcase }}`);
      const spaced = await report(`{{ 'test' | append xyz: 'hello' | upcase }}`);

      expect({ after, before, spaced }).toEqual({
        after: {
          messages: [trailing('append', '@')],
          fixes: [`{{ 'test' | downcase | append: 'world' }}`],
        },
        before: {
          messages: [trailing('append', '!')],
          fixes: [`{{ 'test' | append: 'hello' | upcase }}`],
        },
        spaced: {
          messages: [trailing('append', ' xyz')],
          fixes: [`{{ 'test' | append: 'hello' | upcase }}`],
        },
      });
    });

    it('should report each offending filter of a chain with a fix of its own', async () => {
      // Each fix is applied to the ORIGINAL source, so each leaves the other offense in
      // place — that is what makes them independent corrections rather than one rewrite.
      expect(await report(`{{ 'test' | append@: 'hello' | upcase# }}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{{ 'test' | append: 'hello' | upcase# }}`,
          `{{ 'test' | append@: 'hello' | upcase }}`,
        ],
      });
    });
  });

  describe('Assign tag filters', () => {
    it('should report and fix a trailing character, and a space followed by characters', async () => {
      const special = await report(`{% assign foo = 'HELLO' | append@ %}`);
      const spaced = await report(`{% assign bar = 'HELLO' | append me: 'world' %}`);

      expect({ special, spaced }).toEqual({
        special: {
          messages: [trailing('append', '@')],
          fixes: [`{% assign foo = 'HELLO' | append %}`],
        },
        spaced: {
          messages: [trailing('append', ' me')],
          fixes: [`{% assign bar = 'HELLO' | append: 'world' %}`],
        },
      });
    });

    it('should report each offending filter of an assign chain', async () => {
      expect(await report(`{% assign baz = 'test' | append@: 'hello' | upcase# %}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{% assign baz = 'test' | append: 'hello' | upcase# %}`,
          `{% assign baz = 'test' | append@: 'hello' | upcase %}`,
        ],
      });
    });

    it('should not report on valid assign filters', async () => {
      const offenses = await report(`{% assign valid = 'hello' | append: 'world' | upcase %}`);

      expect(offenses.messages).toEqual([]);
    });
  });

  describe('Echo tag filters', () => {
    it('should report and fix a trailing character, and a space followed by characters', async () => {
      const special = await report(`{% echo 'HELLO' | append@ %}`);
      const spaced = await report(`{% echo 'HELLO' | append me: 'world' %}`);

      expect({ special, spaced }).toEqual({
        special: {
          messages: [trailing('append', '@')],
          fixes: [`{% echo 'HELLO' | append %}`],
        },
        spaced: {
          messages: [trailing('append', ' me')],
          fixes: [`{% echo 'HELLO' | append: 'world' %}`],
        },
      });
    });

    it('should report each offending filter of an echo chain', async () => {
      expect(await report(`{% echo 'test' | append@: 'hello' | upcase# %}`)).toEqual({
        messages: [trailing('append', '@'), trailing('upcase', '#')],
        fixes: [
          `{% echo 'test' | append: 'hello' | upcase# %}`,
          `{% echo 'test' | append@: 'hello' | upcase %}`,
        ],
      });
    });

    it('should not report on valid echo filters', async () => {
      const offenses = await report(`{% echo 'hello' | append: 'world' | upcase %}`);

      expect(offenses.messages).toEqual([]);
    });
  });

  describe('Liquid tag filters', () => {
    // Inside `{% liquid %}` the inner tag carries no delimiters of its own, so the fix has
    // to land at an offset the outer tag decides.
    it('should report and fix an assign and an echo inside a liquid tag', async () => {
      const assigned = await report(
        ['{% liquid', "  assign foo = 'test' | append@: 'hello'", '%}'].join('\n'),
      );
      const echoed = await report(
        ['{% liquid', "  echo 'test' | append@: 'hello'", '%}'].join('\n'),
      );

      expect({ assigned, echoed }).toEqual({
        assigned: {
          messages: [trailing('append', '@')],
          fixes: [['{% liquid', "  assign foo = 'test' | append: 'hello'", '%}'].join('\n')],
        },
        echoed: {
          messages: [trailing('append', '@')],
          fixes: [['{% liquid', "  echo 'test' | append: 'hello'", '%}'].join('\n')],
        },
      });
    });
  });
  /**
   * TASK-80 AC#5. `{{ x | filter, arg }}` — a comma where a colon belongs.
   *
   * The canonical spelling is `| filter: arg1, arg2`: a colon after the NAME, commas only between
   * arguments. So this is always reported. Choosing the REPAIR is the part that needed measuring.
   *
   * A comma never introduces a filter at the runtime. The control is a filter needing NO argument,
   * so chaining after it is valid and the two readings disagree: `{{ 'HELLO' | downcase | size }}`
   * renders 5, while `{{ 'HELLO' | downcase, size }}` raises "downcase filter - wrong number of
   * arguments (given 2, expected 1)". Had the comma chained, both would be 5. Confirmed positively
   * with `{% assign size = 'Z' %}`: `{{ 'HELLO' | append, size }}` renders `HELLOZ`, exactly as
   * `| append: size` does.
   *
   * What differs between cases is the author's intent, and ARITY distinguishes it — read as an
   * argument, `append, ' world'` gives `append` 2 arguments and its arity is exactly 2, so it fits;
   * `upcase, downcase` gives `upcase` 2 and its arity is exactly 1, so the argument reading is
   * impossible and the chain is what was meant.
   *
   * The original delete-everything fix was wrong in every case: it drops arguments the runtime
   * applies, turning `111.00` into `111.000` for `| format_number, precision: 2`.
   */
  describe('a comma where a filter argument separator belongs (TASK-80)', () => {
    it('treats a no-argument filter followed by a comma as a chain, not an argument', async () => {
      // The runtime control, encoded. `downcase` takes no argument, so BOTH readings are expressible
      // and they disagree: `| downcase | size` renders 5, `| downcase, size` raises "downcase filter
      // - wrong number of arguments (given 2, expected 1)". The comma passed an argument.
      //
      // This is the row that establishes the rule the repair is chosen by. An earlier version of
      // this comment cited `{{ 'HELLO' | append | size }}` instead, which raises only because
      // `append` needs an argument of its own — it says nothing about the comma.
      //
      // `reportWith`, not `report`: the chain reading requires `size` to BE a filter, and the
      // default test docset carries six names of which `size` is not one. Naming the docset is the
      // honest fixture — the rule under test is partly about docset membership.
      expect(
        await reportWith(`{{ 'HELLO' | downcase, size }}`, [
          { name: 'downcase', arity: { min: 1, max: 1 } },
          { name: 'size', arity: { min: 1, max: 1 } },
        ]),
      ).toEqual({
        messages: [
          "Syntax is not supported Filter 'downcase' is followed by ', size', but a ',' after a " +
            "filter name passes an argument — and 'downcase' does not accept one, so this raises at " +
            "render. Chain 'size' with '|' instead.",
        ],
        fixes: [`{{ 'HELLO' | downcase | size }}`],
        fixCount: 1,
      });
    });

    it('rewrites to a colon when the argument reading fits the arity', async () => {
      // `append` is exactly 2, so the piped value plus this one argument is a valid call and the
      // comma is simply the wrong separator. Measured: `| append: ' world'` renders `HELLO world`.
      expect(await report(`{{ 'HELLO' | append, ' world' }}`)).toEqual({
        messages: [
          "Syntax is not supported Filter 'append' separates its arguments with ',' instead of ':'. " +
            "Use ':' after the filter name and ',' only between arguments.",
        ],
        fixes: [`{{ 'HELLO' | append: ' world' }}`],
      });
    });

    it('chains instead when the filter cannot take an argument at all', async () => {
      // `upcase` is exactly 1, so the argument reading raises — measured, "wrong number of arguments
      // (given 2, expected 1)". `| upcase | downcase` renders `hello`, which is what was meant.
      // Rewriting this one to a colon, as the previous revision did, produced a guaranteed 500.
      expect(await report(`{{ 'HELLO' | upcase, downcase }}`)).toEqual({
        messages: [
          "Syntax is not supported Filter 'upcase' is followed by ', downcase', but a ',' after a " +
            "filter name passes an argument — and 'upcase' does not accept one, so this raises at " +
            "render. Chain 'downcase' with '|' instead.",
        ],
        fixes: [`{{ 'HELLO' | upcase | downcase }}`],
      });
    });

    it('keeps the argument reading for an identifier that fits, even if a filter shares the name', async () => {
      // The falsifier for "a bare identifier means a filter": `size` IS a filter name, but `append`
      // takes exactly 2 arguments, so `| append, size` is a valid call passing the VARIABLE `size`.
      // Measured `HELLOZ` with `{% assign size = 'Z' %}`. Chaining here would break working code.
      //
      // `size` is put in the docset ON PURPOSE. Under `report`'s six-name default it is not a
      // filter, so the chain branch would be closed to it for the wrong reason and this test would
      // pass without ever exercising the arity that is its actual subject.
      expect(
        await reportWith(`{{ 'HELLO' | append, size }}`, [
          { name: 'append', arity: { min: 2, max: 2 } },
          { name: 'size', arity: { min: 1, max: 1 } },
        ]),
      ).toEqual({
        messages: [
          "Syntax is not supported Filter 'append' separates its arguments with ',' instead of ':'. " +
            "Use ':' after the filter name and ',' only between arguments.",
        ],
        fixes: [`{{ 'HELLO' | append: size }}`],
        fixCount: 1,
      });
    });

    it('removes a trailing comma with nothing after it', async () => {
      // Rewriting this to `:` produced `| append: `, a syntax error at render whose re-lint reports
      // nothing — a file that looks clean and 500s. There is no argument here to preserve.
      expect(await report(`{{ 'HELLO' | append, }}`)).toEqual({
        messages: [
          "Syntax is not supported Filter 'append' has a trailing ',' with nothing after it.",
        ],
        fixes: [`{{ 'HELLO' | append }}`],
      });
    });

    const withFilters = (filters: FilterEntry[]) => ({
      platformosDocset: {
        async filters() {
          return filters;
        },
        async tags() {
          return [];
        },
        async objects() {
          return [];
        },
        async liquidDrops() {
          return [];
        },
        async liquidDoc() {
          return { annotations: [], param_types: [] };
        },
        async graphQL() {
          return null;
        },
      } as any,
    });

    const reportWith = async (sourceCode: string, filters: FilterEntry[]) => {
      const offenses = await runLiquidCheck(
        LiquidHTMLSyntaxError,
        sourceCode,
        'app/views/partials/file.liquid',
        withFilters(filters),
      );
      return {
        messages: messagesOf(offenses),
        fixes: offenses.map((offense) => applyFix(sourceCode, offense)),
        fixCount: offenses.filter((offense) => offense.fix).length,
      };
    };

    const SLICE: FilterEntry[] = [{ name: 'slice', arity: { min: 2, max: 3 } }];

    /**
     * THE CHAIN READING NEEDS THREE FACTS, and the first revision of this feature checked one.
     *
     * A bare identifier after the comma is the only shape that COULD have meant a filter. Reading
     * it as one is only justified when it names a filter that exists, and when the left filter
     * cannot take the argument at all — a BOUNDED max below 2. "2 is outside the arity range" is
     * not that test: it is also true when the range starts above 2, and it is unanswerable when
     * the arity is unknown.
     */
    describe('choosing between the chain and the argument reading', () => {
      const ADD_HASH_KEY: FilterEntry[] = [
        { name: 'add_hash_key', arity: { min: 3, max: 3 } },
        { name: 'key', arity: { min: 1, max: 1 } },
      ];

      it('does not chain a filter whose arity STARTS above two', async () => {
        // `add_hash_key` accepts two arguments beyond the piped value, so `, key` is an argument
        // reading that is merely INCOMPLETE, not impossible. `acceptsArgumentCount(arity, 2)` is
        // false here just as it is for `upcase`, and the chain branch therefore claimed
        // "'add_hash_key' does not accept one" — false — and chained the argument away. Nine
        // shipped filters have `min >= 3`.
        //
        // `key` is deliberately a real filter here, so the only thing keeping this out of the
        // chain branch is the arity test itself.
        expect(await reportWith(`{{ obj | add_hash_key, key }}`, ADD_HASH_KEY)).toEqual({
          messages: [
            "Syntax is not supported Filter 'add_hash_key' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ obj | add_hash_key: key }}`],
          fixCount: 1,
        });
      });

      it('does not chain an identifier that is not a filter', async () => {
        // `my_suffix` is a VARIABLE the author meant to pass. It has the shape of a filter name, and
        // the chain repair rewrote `{{ 'a' | upcase, my_suffix }}` to `{{ 'a' | upcase | my_suffix }}`
        // — deleting the argument and calling a filter nobody wrote. The docset is in scope here and
        // is now consulted, exactly as it is for the filter on the LEFT of the comma.
        expect(
          await reportWith(`{{ 'a' | upcase, my_suffix }}`, [
            { name: 'upcase', arity: { min: 1, max: 1 } },
          ]),
        ).toEqual({
          messages: [
            "Syntax is not supported Filter 'upcase' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ 'a' | upcase: my_suffix }}`],
          fixCount: 1,
        });
      });

      it('CONTROL: still chains when all three facts hold', async () => {
        // Same left filter as the test above, same shape on the right — the only difference is that
        // `downcase` IS a filter. Without this row, the two tests above would pass just as well with
        // the chain branch deleted outright.
        expect(
          await reportWith(`{{ 'a' | upcase, downcase }}`, [
            { name: 'upcase', arity: { min: 1, max: 1 } },
            { name: 'downcase', arity: { min: 1, max: 1 } },
          ]),
        ).toEqual({
          messages: [
            "Syntax is not supported Filter 'upcase' is followed by ', downcase', but a ',' after a " +
              "filter name passes an argument — and 'upcase' does not accept one, so this raises at " +
              "render. Chain 'downcase' with '|' instead.",
          ],
          fixes: [`{{ 'a' | upcase | downcase }}`],
          fixCount: 1,
        });
      });

      it('rewrites the separator when NEITHER source knows the arity, and says so by staying quiet after', async () => {
        // `falsy_argument_error` is published without an `arity`, so `resolveArity` returns
        // undefined — the docset is the only source. An unknown arity cannot support the
        // chain reading — it used to, by defaulting `argumentFits` to true — and the separator
        // repair is the right answer because the comma and colon forms are the SAME call: the
        // rewrite cannot change what the page renders, only whether the file parses.
        //
        // The resulting silence is `FilterArity`'s existing unknown-stays-unknown silence, not a new
        // one. The row below pins that it IS the arity that is missing, by giving the same filter an
        // arity and watching the message change.
        const unknown = await reportWith(`{{ value | falsy_argument_error, downcase }}`, [
          { name: 'falsy_argument_error' },
          { name: 'downcase', arity: { min: 1, max: 1 } },
        ]);
        const known = await reportWith(`{{ value | falsy_argument_error, downcase }}`, [
          { name: 'falsy_argument_error', arity: { min: 1, max: 1 } },
          { name: 'downcase', arity: { min: 1, max: 1 } },
        ]);

        expect({ unknown: unknown.fixes, known: known.fixes }).toEqual({
          unknown: [`{{ value | falsy_argument_error: downcase }}`],
          known: [`{{ value | falsy_argument_error | downcase }}`],
        });
      });
    });

    /**
     * A REPAIR THAT DOES NOT PARSE IS NOT OFFERED.
     *
     * The colon rewrite was emitted unconditionally, so a comma-led segment that is not a
     * well-formed argument list was "repaired" into source that still had string markup — nothing
     * parsed it, so no check reported it, and the author was left with a file the linter called
     * clean and the runtime answered with a 500. That is the same state the trailing-comma branch
     * exists to prevent.
     *
     * The offense still reports; only the autofix is withheld, which is the honest answer when the
     * author's intent cannot be recovered.
     */
    describe('a repair that would not parse', () => {
      const APPEND: FilterEntry[] = [{ name: 'append', arity: { min: 2, max: 2 } }];

      it('reports without a fix when the colon rewrite would still not parse', async () => {
        // Two adjacent literals are not an argument list, so `| append: 'a' 'b'` is as unparseable
        // as `| append, 'a' 'b'` was.
        expect(await reportWith(`{{ 'HELLO' | append, 'a' 'b' }}`, APPEND)).toEqual({
          messages: [
            "Syntax is not supported Filter 'append' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ 'HELLO' | append, 'a' 'b' }}`],
          fixCount: 0,
        });
      });

      it('CONTROL: still fixes the same shape when the rewrite does parse', async () => {
        // One literal instead of two — otherwise identical. Without this row the test above would
        // pass with every fix removed from the check.
        expect(await reportWith(`{{ 'HELLO' | append, 'a' }}`, APPEND)).toEqual({
          messages: [
            "Syntax is not supported Filter 'append' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ 'HELLO' | append: 'a' }}`],
          fixCount: 1,
        });
      });
    });

    /**
     * MORE THAN ONE ARGUMENT after the comma, which the single-identifier cases above do not cover.
     *
     * The comma passes ALL of the following values, measured: `{{ 'abcdef' | slice, 1, 2 }}` renders
     * `bc`, exactly as `| slice: 1, 2` does, and `| slice, 1, 2, 3` raises "given 4, expected 2..3".
     * So a multi-argument segment can only be arguments — no bare identifier to mistake for a
     * filter — and rewriting to `:` preserves the call whether or not the call is valid.
     *
     * `slice` and `format_number` are not in the small default test docset, and this check skips a
     * filter the docset does not carry, so these run against the docset entries they need.
     */
    describe('with more than one argument after the comma', () => {
      it('rewrites to a colon and keeps every argument', async () => {
        // Renders `bc` before and after, so the repair is behaviour-preserving.
        expect(await reportWith(`{{ 'abcdef' | slice, 1, 2 }}`, SLICE)).toEqual({
          messages: [
            "Syntax is not supported Filter 'slice' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ 'abcdef' | slice: 1, 2 }}`],
          fixCount: 1,
        });
      });

      it('rewrites the separator even when the call has too many arguments, leaving the count to FilterArity', async () => {
        // `| slice, 1, 2, 3` raises "given 4, expected 2..3" before AND after. This check owns the
        // SEPARATOR only; fixing it is what lets `FilterArity` see the call and report the count.
        // Trying to judge the count here would be a second, weaker arity implementation.
        expect(await reportWith(`{{ 'abcdef' | slice, 1, 2, 3 }}`, SLICE)).toEqual({
          messages: [
            "Syntax is not supported Filter 'slice' separates its arguments with ',' instead of ':'. " +
              "Use ':' after the filter name and ',' only between arguments.",
          ],
          fixes: [`{{ 'abcdef' | slice: 1, 2, 3 }}`],
          fixCount: 1,
        });
      });

      it('says nothing when the comma is a LEGITIMATE argument separator after a colon', async () => {
        // `{{ 'hello' | append: ' suffix', size }}` is correct syntax — colon after the name, comma
        // between arguments — and it raises only because `append` takes exactly 2. That is an ARITY
        // error, not a syntax one, so this check must stay silent and `FilterArity` must report it.
        // The control below is the same call with the separator wrong, which this check does own.
        const legitimate = await reportWith(`{{ 'hello' | append: ' suffix', size }}`, [
          { name: 'append', arity: { min: 2, max: 2 } },
        ]);
        const wrongSeparator = await reportWith(`{{ 'hello' | append, ' suffix', size }}`, [
          { name: 'append', arity: { min: 2, max: 2 } },
        ]);

        expect({ legitimate, wrongSeparator }).toEqual({
          legitimate: { messages: [], fixes: [], fixCount: 0 },
          wrongSeparator: {
            messages: [
              "Syntax is not supported Filter 'append' separates its arguments with ',' instead of ':'. " +
                "Use ':' after the filter name and ',' only between arguments.",
            ],
            fixes: [`{{ 'hello' | append: ' suffix', size }}`],
            fixCount: 1,
          },
        });
      });
    });

    it('still deletes trailing characters that are not arguments', async () => {
      // The control. Only a comma-introduced segment is arguments; anything else is junk.
      expect(await report(`{{ 'HELLO' | append@ }}`)).toEqual({
        messages: [trailing('append', '@')],
        fixes: [`{{ 'HELLO' | append }}`],
      });
    });

    it('every repair leaves source that PARSES and that this check no longer reports', async () => {
      // The property the old fix broke: it emitted `| append: ` and then reported nothing, so the
      // next lint was green while the page 500s.
      //
      // SILENCE ALONE DOES NOT ESTABLISH IT, which is why `parses` is asserted alongside. An
      // unparseable repair — `| append: 'a' 'b'` — is silent for the same reason `| append: ` was:
      // this check only looks at markup the grammar rejected, and it stops matching once a colon
      // follows the name. `remaining: []` was therefore satisfied by exactly the outputs the test
      // was written to catch. Parseability is the fact that separates the two.
      // An offense with no fix is not a repair and is excluded — `{{ 'HELLO' | append, 'a' 'b' }}`
      // is deliberately in the list to exercise that arm, and `repairs` below pins that the other
      // four DID produce one, so the exclusion cannot quietly empty the property.
      const sources = [
        `{{ 'HELLO' | append, ' world' }}`,
        `{{ 'HELLO' | upcase, downcase }}`,
        `{{ 'HELLO' | append, }}`,
        `{{ 'HELLO' | append@ }}`,
        `{{ 'HELLO' | append, 'a' 'b' }}`,
      ];
      let repairs = 0;

      for (const source of sources) {
        const offenses = await runLiquidCheck(LiquidHTMLSyntaxError, source);

        for (const offense of offenses.filter((candidate) => candidate.fix)) {
          repairs++;
          const fixed = applyFix(source, offense) as string;
          const again = await runLiquidCheck(LiquidHTMLSyntaxError, fixed);
          const ast = toLiquidHtmlAST(fixed) as any;

          expect({
            source,
            fixed,
            parses: typeof ast.children[0].markup !== 'string',
            remaining: messagesOf(again),
          }).toEqual({ source, fixed, parses: true, remaining: [] });
        }
      }

      expect(repairs).toBe(4);
    });
  });
});
