import { describe, expect, it } from 'vitest';

import { FilterWithoutEffect } from './index';
import { check, MockApp } from '../../test';

/**
 * TASK-47. A filter the deploy converter ACCEPTS and the runtime never APPLIES.
 *
 * Both directions are load-bearing: refusing these constructs was a false block on files that
 * deploy, and approving them silently ships code that does not do what its author wrote. So
 * the SILENT group below is a genuine control — a predicate wide enough to warn about every
 * filter in the language would satisfy the reporting group on its own.
 *
 * Every row was measured against a live instance, never inferred from the grammar, using the
 * strongest lens the position allows:
 *
 *   observable   `{% case 'a' | upcase %}{% when 'A' %}…{% when 'a' %}` matches 'a'
 *   observable   `{% assign h = {} %}{% hash_assign h['k'] = 'a' | upcase %}{{ h['k'] }}` -> A
 *   observable   a partial that reads an argument back reports the value it was HANDED
 *   raises       `{{ 'a' | no_such_filter_xyz }}` raises Liquid::UndefinedFilter
 *
 * An observable probe shows the filter's effect directly; "renders clean" only shows nothing
 * raised, which for `background` merely proved the work happened in a worker. Each probe was
 * paired with a filterless control — one that fails identically kills the probe, as
 * `response_headers` did with its 501.
 *
 * THE TRAILING-FILTER ROWS ARE WHY THE OBSERVABLE LENS IS NOT OPTIONAL. `function`, `background`
 * and `graphql` share one grammar rule and one Ruby-looking shape, and a "renders clean" probe
 * says the same thing about all three. Reading the assigned value back separates them: only
 * `graphql`'s FILE form filters its result. The other two were silent here for a whole release
 * on the strength of the shape argument alone.
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
 * Both spellings are written out rather than derived by stripping the filter with a regex — an
 * earlier version did that and silently failed to strip `| plus: 0`.
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
  // TRAILING filters on tags that only LOOK like they filter a result. Measured: the append is
  // a no-op on the assigned value, and `no_such_filter_xyz` in the same position does not raise,
  // so the filter is never evaluated at all. Contrast `graphql`'s FILE form, which is in
  // APPLIES_THE_FILTER below — the discriminator is the tag, and it had to be measured per tag.
  [
    'function trailing filter',
    `{% function r = 'p', a: 1 | dig: 'x' %}`,
    `{% function r = 'p', a: 1 %}`,
  ],
  [
    'function trailing filter without arguments',
    `{% function r = 'p' | dig: 'x' %}`,
    `{% function r = 'p' %}`,
  ],
  [
    'background trailing filter',
    `{% background j = 'p', a: 1 | dig: 'x' %}`,
    `{% background j = 'p', a: 1 %}`,
  ],
  [
    'background trailing filter without arguments',
    `{% background j = 'p' | dig: 'x' %}`,
    `{% background j = 'p' %}`,
  ],
  [
    'graphql INLINE trailing filter',
    `{% graphql g, a: 1 | dig: 'x' %}q{% endgraphql %}`,
    `{% graphql g, a: 1 %}q{% endgraphql %}`,
  ],
  // It is the LAST argument that decides, not "some argument is a JSON literal". Measured:
  // `payload: {"a": 1}, zzz: 1 | json` left `payload` a hash and the result unfiltered, whereas
  // the same filter with the literal LAST reached it. Without this row, dropping the
  // `[args.length - 1]` index for an `args.some(isJsonLiteral)` would pass every other fixture.
  [
    'trailing filter after a non-JSON last argument',
    `{% function r = 'p', data: {"a": 1}, a: 1 | dig: 'x' %}`,
    `{% function r = 'p', data: {"a": 1}, a: 1 %}`,
  ],
];

/** Positions measured to APPLY the filter. Every one of these must stay SILENT. */
const APPLIES_THE_FILTER: Array<[label: string, source: string]> = [
  ['variable output', `{{ 'a' | upcase }}`],
  ['assign', `{% assign x = 'a' | upcase %}`],
  ['echo', `{% echo 'a' | upcase %}`],
  ['print', `{% print 'a' | upcase %}`],
  ['return', `{% return 'a' | upcase %}`],
  ['session', `{% session s = 'a' | upcase %}`],
  // Write-tag RHS spellings an author actually writes. They reduce to two fields the check
  // keys on — `AssignMarkup.value` and `HashAssignMarkup.value` — so they are here as the
  // measured record, not as independent paths. Read back observably: h['k'] -> A, a[0] -> X.
  ['assign to a bracket path', `{% assign h['k'] = 'a' | upcase %}`],
  ['assign appending to an array', `{% assign a << 'x' | upcase %}`],
  ['hash_assign', `{% hash_assign h['k'] = 'a' | upcase %}`],
  ['hash_assign with a filter chain', `{% hash_assign p['edited_at'] = 'now' | to_time | json %}`],
  ['hash_assign with a filter argument', `{% hash_assign h['a'] = h['a'] | hash_merge: id: x %}`],
  ['output inside an HTML attribute', `<div class="{{ x | upcase }}"></div>`],
  ['output inside a tag body', `{% cache 'k' %}{{ x | upcase }}{% endcache %}`],
  // An argument value that IS a JSON literal goes through `Liquid::JsonLiteralVariable`, the one
  // argument parser that consumes filters. Measured observably: a function whose partial reads
  // the argument back received the JSON STRING for `payload: {"a": 1} | json`, and `| json |
  // upcase` arrived as {"A":1} — both filters, in order. The value shape decides this, not the
  // tag, which is why it cannot be an entry in APPLIES_BY_PARENT_FIELD.
  ['JSON hash argument', `{% log 'm', data: {"a": 1} | json %}`],
  ['JSON array argument', `{% function r = 'p', items: [1, 2, 3] | reverse %}`],
  // The ONE tag measured to split its markup on the first `|` and filter its RESULT: `dig:
  // 'users'` restructured the returned hash, and `no_such_filter_xyz` there raises. Its INLINE
  // form does neither and sits in IGNORES_THE_FILTER above — same tag, opposite answers.
  ['graphql FILE result filter', `{% graphql g = 'q', a: 1 | dig: 'x' %}`],
];

describe('Module: FilterWithoutEffect', () => {
  it('reports the whole offense for a canonical case', async () => {
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
        // The FILTER is highlighted, not the value; a LiquidFilter's range opens at the
        // whitespace before its `|`, hence 21 rather than 22.
        start: { index: 21, line: 0, character: 21 },
        end: { index: 30, line: 0, character: 30 },
        // No autofix: the repair needs an {% assign %} on a PRECEDING line, which the
        // corrector cannot express.
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
    // The control that bites the `filters.length === 0` guard. `graphqlNamedArgumentValue` is
    // the one position that ALWAYS builds a LiquidVariable, with `filters: []` by construction,
    // and it is not in the applying allowlist — so without the guard every graphql named
    // argument in every project is warned about. The filterless sweep below cannot catch that:
    // an unfiltered tag argument produces no LiquidVariable at all, so the visitor never runs.
    expect(await messages(`{% graphql g = 'q', name: val %}`)).toEqual([]);
    expect(await messages(`{% graphql g = 'q', a: x, b: y %}`)).toEqual([]);
  });

  it('stays silent on the filterless spelling of every reported construct', async () => {
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
    expect(FilterWithoutEffect.meta.severity).toEqual(1);
  });
});
