import { describe, expect, it } from 'vitest';

import { FilterWithoutEffect } from './index';
import { check, MockApp } from '../../test';

/**
 * TASK-47. A filter the deploy converter ACCEPTS and the runtime never APPLIES.
 *
 * WHY BOTH DIRECTIONS ARE PINNED HERE. This check exists because of a two-sided defect:
 * refusing these constructs was an unappealable false block on files that deploy, and
 * approving them silently ships code that does not do what its author wrote. So the
 * reporting cases and the SILENT cases are equally load-bearing, and the silent group is a
 * genuine control — a predicate wide enough to warn about every filter in the language would
 * satisfy the reporting group on its own.
 *
 * EVERY ROW WAS MEASURED against `/api/app_builder/liquid_exec`, not inferred from the
 * grammar. `no_such_filter_xyz` raises `Liquid::UndefinedFilter` wherever the runtime
 * evaluates it, so a construct that renders clean proves the filter was never seen. Each
 * probe was paired with a filterless control that renders clean, which is what distinguishes
 * "the filter is ignored" from "the fixture is wrong" — seven fixtures failed that way and
 * were discarded rather than reported.
 *
 * Three independent lenses agreed:
 *
 *   {{ 'a' | no_such_filter_xyz }}                       RAISES UndefinedFilter   control
 *   {% assign x = 'a' | no_such_filter_xyz %}            RAISES                   control
 *   {{ 'a' | upcase: 1, 2, 3 }}                          RAISES ArgumentError     control
 *   {% cache 'k' | no_such_filter_xyz %}x{% endcache %}  renders clean
 *   {% log 'm', type: 't' | no_such_filter_xyz %}        renders clean
 *   {% case 'a' | upcase %}{% when 'A' %}…{% when 'a' %} matches 'a'              decisive
 *
 * The `case` row is the strongest evidence available: the filter's effect on control flow is
 * directly observable and the UNFILTERED branch wins.
 *
 * The mechanism, which is why this is a class and not a list: Ruby Liquid parses these
 * markups with its own scanner, and `TagAttributes` captures `QuotedFragment`, which
 * explicitly excludes `|`.
 */
const offensesFor = (liquid: string) => {
  const app: MockApp = { 'app/views/pages/index.liquid': liquid };
  return check(app, [FilterWithoutEffect]);
};

const messages = async (liquid: string) =>
  (await offensesFor(liquid)).map((offense) => offense.message);

/**
 * Positions measured to IGNORE the filter, each paired with its FILTERLESS spelling.
 *
 * The pairing is explicit rather than derived by stripping the filter with a regex. The first
 * version did that and the regex silently failed to strip `| plus: 0`, so a "filterless"
 * fixture still carried a filter and the control test failed for a reason that had nothing to
 * do with the code. Writing both spellings out cannot go wrong that way, and it mirrors how
 * every row was measured: the construct with the filter, then again without it.
 */
const IGNORES_THE_FILTER: Array<[label: string, filtered: string, filterless: string]> = [
  ['cache key', `{% cache 'k' | upcase %}x{% endcache %}`, `{% cache 'k' %}x{% endcache %}`],
  [
    'cache named argument',
    `{% cache 'k', expire: 60 | plus: 1 %}x{% endcache %}`,
    `{% cache 'k', expire: 60 %}x{% endcache %}`,
  ],
  ['log value', `{% log 'm' | upcase %}`, `{% log 'm' %}`],
  ['log named argument', `{% log 'm', type: 't' | upcase %}`, `{% log 'm', type: 't' %}`],
  ['log positional argument', `{% log 'm', 't' | upcase %}`, `{% log 'm', 't' %}`],
  [
    'case subject',
    `{% case 'a' | upcase %}{% when 'b' %}y{% endcase %}`,
    `{% case 'a' %}{% when 'b' %}y{% endcase %}`,
  ],
  [
    'when',
    `{% case 'a' %}{% when 'b' | upcase %}y{% endcase %}`,
    `{% case 'a' %}{% when 'b' %}y{% endcase %}`,
  ],
  ['cycle', `{% cycle 'a' | upcase, 'b' %}`, `{% cycle 'a', 'b' %}`],
  ['yield', `{% yield 'a' | upcase %}`, `{% yield 'a' %}`],
  ['redirect_to url', `{% redirect_to '/p' | upcase %}`, `{% redirect_to '/p' %}`],
  ['render named argument', `{% render 'p', a: 1 | plus: 1 %}`, `{% render 'p', a: 1 %}`],
  ['context named argument', `{% context k: 'v' | upcase %}`, `{% context k: 'v' %}`],
  [
    'transaction named argument',
    `{% transaction timeout: 5 | plus: 1 %}x{% endtransaction %}`,
    `{% transaction timeout: 5 %}x{% endtransaction %}`,
  ],
  [
    'background named argument',
    `{% background a: 1 | plus: 1 %}x{% endbackground %}`,
    `{% background a: 1 %}x{% endbackground %}`,
  ],
  ['export namespace', `{% export x, namespace: 'n' | upcase %}`, `{% export x, namespace: 'n' %}`],
  [
    'form named argument',
    `{% form m: 'x' | upcase %}y{% endform %}`,
    `{% form m: 'x' %}y{% endform %}`,
  ],
  [
    'form positional argument',
    `{% form 'x' | upcase %}y{% endform %}`,
    `{% form 'x' %}y{% endform %}`,
  ],
  ['hash pair value', `{% log 'm', f: type: 'a' | upcase %}`, `{% log 'm', f: type: 'a' %}`],
  // A third operand shape: the value stays restricted to a number or a lookup and only the
  // filter suffix was added, so `{% response_status 'abc' %}` still fails to parse.
  ['response_status', `{% response_status 200 | plus: 0 %}`, `{% response_status 200 %}`],
];

/**
 * Positions measured to APPLY the filter. Every one of these must stay SILENT.
 *
 * This is the control group, and it is the reason the check allowlists APPLYING positions
 * rather than enumerating ignoring ones.
 */
const APPLIES_THE_FILTER: Array<[label: string, source: string]> = [
  ['variable output', `{{ 'a' | upcase }}`],
  ['assign', `{% assign x = 'a' | upcase %}`],
  ['echo', `{% echo 'a' | upcase %}`],
  ['print', `{% print 'a' | upcase %}`],
  ['return', `{% return 'a' | upcase %}`],
  ['session', `{% session s = 'a' | upcase %}`],
  ['output inside an HTML attribute', `<div class="{{ x | upcase }}"></div>`],
  ['output inside a tag body', `{% cache 'k' %}{{ x | upcase }}{% endcache %}`],
  // A markup-level trailing filter is a different AST shape: it hangs off the markup node,
  // not off a LiquidVariable. `{% return 'a' | upcase %}` has that shape and was measured to
  // APPLY, and this one filters the function's RESULT.
  ['function result filter', `{% function r = 'p', a: 1 | dig: 'x' %}`],
];

describe('Module: FilterWithoutEffect', () => {
  it('reports the whole offense for a canonical case', async () => {
    // One case asserted in full, so the message, the range and the severity are all pinned
    // rather than implied by the sweeps below.
    const offenses = await offensesFor(`{% log 'm', type: 't' | upcase %}`);

    expect(offenses).toEqual([
      {
        check: 'FilterWithoutEffect',
        message:
          "Filter 'upcase' has no effect here. platformOS parses this tag markup with its " +
          'own scanner and never applies the filter, so the unfiltered value is used. Apply ' +
          'it in an {% assign %} first and pass the assigned variable.',
        uri: 'file:///app/views/pages/index.liquid',
        severity: 1,
        type: 'LiquidHtml',
        // The FILTER is highlighted, not the value. A LiquidFilter's range opens at the
        // whitespace before its `|`, so this starts at 21 (the space) and ends after
        // `upcase` at 30 — measured against the parser rather than counted by eye, which
        // is how the first version of this assertion was wrong.
        start: { index: 21, line: 0, character: 21 },
        end: { index: 30, line: 0, character: 30 },
        // No autofix, deliberately: the repair needs an {% assign %} on a PRECEDING line,
        // which the corrector cannot express, and deleting the filter would silently change
        // what the author wrote.
        fix: undefined,
        suggest: undefined,
      },
    ]);
  });

  it('reports every position measured to ignore the filter', async () => {
    const reported = await Promise.all(
      IGNORES_THE_FILTER.map(async ([label, filtered]) => [
        label,
        (await messages(filtered)).length,
      ]),
    );

    expect(Object.fromEntries(reported)).toEqual(
      Object.fromEntries(IGNORES_THE_FILTER.map(([label]) => [label, 1])),
    );
  });

  it('stays SILENT in every position measured to apply the filter', async () => {
    const reported = await Promise.all(
      APPLIES_THE_FILTER.map(async ([label, source]) => [label, await messages(source)]),
    );

    expect(Object.fromEntries(reported)).toEqual(
      Object.fromEntries(APPLIES_THE_FILTER.map(([label]) => [label, []])),
    );
  });

  it('stays silent on a zero-filter LiquidVariable, which graphql arguments always produce', async () => {
    // THE CONTROL THAT ACTUALLY BITES, and it took a sabotage to find. Deleting the
    // `filters.length === 0` guard left the filterless sweep below entirely green, because an
    // unfiltered tag argument produces no LiquidVariable at all — `tagArgumentValue` falls
    // through to a bare expression — so the visitor never runs and the guard is unreachable
    // from those fixtures. The test was decorative.
    //
    // `graphqlNamedArgumentValue` is the one position that ALWAYS builds a LiquidVariable,
    // with `filters: []` by construction. It is not in the applying allowlist, so without the
    // guard every graphql named argument in every project would be warned about.
    expect(await messages(`{% graphql g = 'q', name: val %}`)).toEqual([]);
    expect(await messages(`{% graphql g = 'q', a: x, b: y %}`)).toEqual([]);
  });

  it('stays silent on the filterless spelling of every reported construct', async () => {
    // Weaker than the graphql control above — see its comment — but it pins that the fix did
    // not start reporting ordinary tag arguments, which is what an author writes all day.
    const reported = await Promise.all(
      IGNORES_THE_FILTER.map(async ([label, , filterless]) => [label, await messages(filterless)]),
    );

    expect(Object.fromEntries(reported)).toEqual(
      Object.fromEntries(IGNORES_THE_FILTER.map(([label]) => [label, []])),
    );
  });

  it('names every filter when a value carries a chain of them', async () => {
    expect(await messages(`{% log 'm', type: 't' | upcase | strip %}`)).toEqual([
      "Filters 'upcase', 'strip' have no effect here. platformOS parses this tag markup with " +
        'its own scanner and never applies the filter, so the unfiltered value is used. ' +
        'Apply it in an {% assign %} first and pass the assigned variable.',
    ]);
  });

  it('does NOT block: this is a warning on a file that deploys and renders', async () => {
    // The severity is the finding. The converter accepts these constructs and the page
    // renders, so blocking would be the false block this check was created to remove.
    expect(FilterWithoutEffect.meta.severity).toEqual(1);
  });
});
