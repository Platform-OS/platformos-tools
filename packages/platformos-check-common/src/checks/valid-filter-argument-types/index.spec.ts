import { describe, expect, it } from 'vitest';

import { publishedDocset } from '../../test/published-docset';
import { applySuggestions, messagesOf, runLiquidCheck } from '../../test';
import { docsetParameterType, filterTypesAreContracts } from '../../liquid-types';
import { FilterEntry, Parameter } from '../../types';
import { ValidFilterArgumentTypes } from './index';

/**
 * AGAINST THE SHIPPED `filters.json`, transformed rather than replaced.
 */
const parameter = (name: string, types: string[], extra: Partial<Parameter> = {}): Parameter => ({
  name,
  description: '',
  required: false,
  types,
  positional: true,
  variadic: false,
  default: '',
  ...extra,
});

/** One filter's parameter list stated, aliases included, over whatever document it is given. */
const statedOn = (
  filters: FilterEntry[],
  filterName: string,
  parameters: Parameter[],
): FilterEntry[] => {
  const canonical = filters.find((entry) => entry.name === filterName);
  const spellings = new Set([filterName, ...(canonical?.aliases ?? [])]);

  return filters.map((entry) => (spellings.has(entry.name) ? { ...entry, parameters } : entry));
};

/** The same, over the shipped document. */
const withParameters = async (filterName: string, parameters: Parameter[]) =>
  statedOn(await publishedDocset.filters(), filterName, parameters);

/**
 * `split` stated as a way to PRODUCE an array, which is all these cases use it for.
 */
const withSplit = (filters: FilterEntry[]) =>
  statedOn(filters, 'split', [
    parameter('input', ['untyped'], { required: true }),
    parameter('pattern', ['string'], { required: true }),
  ]);

/**
 * The marker that makes published types contracts, guaranteed present.
 *
 * `translate`'s options hash accepts several types — the named arguments it gathers are strings,
 * numbers and booleans — so it is the entry this repository would have to declare `untyped` if the
 * platform had not yet; saying so here says the same thing about the same parameter.
 */
const contractual = (filters: FilterEntry[]): FilterEntry[] => {
  if (filterTypesAreContracts(filters)) return filters;

  return filters.map((entry) =>
    entry.name === 'translate'
      ? {
          ...entry,
          parameters: (entry.parameters ?? []).map((candidate) =>
            candidate.name === 'options' ? { ...candidate, types: ['untyped'] } : candidate,
          ),
        }
      : entry,
  );
};

const check = (source: string, filters: FilterEntry[]) =>
  runLiquidCheck(ValidFilterArgumentTypes, source, undefined, {
    platformosDocset: { ...publishedDocset, filters: async () => filters },
  });

/** The filter the report came in about, as the platform documents and enforces it. */
const HASH_ADD_KEY = [
  parameter('hash', ['object'], { required: true }),
  parameter('key', ['string'], { required: true }),
  parameter('value', ['untyped'], { required: true }),
];

const hashAddKey = async (parameters: Parameter[] = HASH_ADD_KEY) =>
  contractual(await withParameters('hash_add_key', parameters));

const mismatch = (subject: string, expected: string, actual: string) =>
  `Type mismatch for ${subject}: expected ${expected}, got ${actual}. ` +
  `platformOS raises Liquid::ArgumentError at render time.`;

/** A literal of a type the expected one cannot be, and the name the check gives what it read. */
const wrongValueFor = (type: string) => (type === 'number' ? `'nope'` : '5');
const wrongTypeFor = (type: string) => (type === 'number' ? 'string' : 'number');

describe('Module: ValidFilterArgumentTypes', () => {
  it('reports a piped value that contradicts the published type', async () => {
    // The call the report came in about: platformOS raises `hash_add_key filter - first argument must
    // be a hash, received: 123` and the page 500s, so the type is a contract here.
    expect(
      messagesOf(await check(`{{ 123 | hash_add_key: 'hello', 'world' }}`, await hashAddKey())),
    ).toEqual([mismatch(`the value piped into 'hash_add_key'`, 'object', 'number')]);
  });

  it('reports a written argument that contradicts the published type', async () => {
    expect(
      messagesOf(await check(`{{ h | hash_add_key: 5, 'world' }}`, await hashAddKey())),
    ).toEqual([mismatch(`argument 'key' of 'hash_add_key'`, 'string', 'number')]);
  });

  it('reports the piped value and a written argument in the same call', async () => {
    expect(
      messagesOf(await check(`{{ 123 | hash_add_key: 5, 'world' }}`, await hashAddKey())),
    ).toEqual([
      mismatch(`the value piped into 'hash_add_key'`, 'object', 'number'),
      mismatch(`argument 'key' of 'hash_add_key'`, 'string', 'number'),
    ]);
  });

  it('says nothing about a parameter the docset publishes as untyped', async () => {
    const filters = await hashAddKey([
      parameter('hash', ['untyped'], { required: true }),
      parameter('key', ['string'], { required: true }),
      parameter('value', ['untyped'], { required: true }),
    ]);

    expect(messagesOf(await check(`{{ 123 | hash_add_key: 'hello', 'world' }}`, filters))).toEqual(
      [],
    );
  });

  it('says nothing about a variable the file never assigns', async () => {
    // Narrower than it reads: an ASSIGNED variable does have a type here now, and the cases in
    // 'a variable this file assigns' below are the other half of this claim.
    expect(
      messagesOf(await check(`{{ maybe | hash_add_key: key, value }}`, await hashAddKey())),
    ).toEqual([]);
  });

  it('says nothing about nil, which is no value rather than a wrong one', async () => {
    expect(
      messagesOf(await check(`{{ nil | hash_add_key: nil, nil }}`, await hashAddKey())),
    ).toEqual([]);
  });

  it('accepts a hash literal where a Hash is expected', async () => {
    expect(
      messagesOf(await check(`{{ {"a": 1} | hash_add_key: 'b', 2 }}`, await hashAddKey())),
    ).toEqual([]);
  });

  describe('when the docset does not separate a Hash from "anything"', () => {
    /** Every `object` in such a document might mean either, so none of them is a contract. */
    const ambiguous = async () =>
      (await withParameters('hash_add_key', HASH_ADD_KEY)).map((entry) => ({
        ...entry,
        parameters: (entry.parameters ?? []).map((candidate) =>
          candidate.types?.includes('untyped') ? { ...candidate, types: ['object'] } : candidate,
        ),
      }));

    it('reports nothing at all', async () => {
      const filters = await ambiguous();

      expect(filterTypesAreContracts(filters)).toBe(false);
      expect(
        messagesOf(await check(`{{ 123 | hash_add_key: 'hello', 'world' }}`, filters)),
      ).toEqual([]);
    });

    it('CONTROL: the same fixture reports once the document separates them', async () => {
      const filters = await hashAddKey();

      expect(filterTypesAreContracts(filters)).toBe(true);
      expect(
        messagesOf(await check(`{{ 123 | hash_add_key: 'hello', 'world' }}`, filters)),
      ).not.toEqual([]);
    });
  });

  it('resolves a piped value from the last filter in the chain', async () => {
    // `plus` publishes a `number` return type, so the value reaching the next filter is known without
    // a symbol table — and it is the LAST filter that decides, not the original expression.
    const filters = contractual(
      await withParameters('markdown', [parameter('text', ['string'], { required: true })]),
    );

    expect(messagesOf(await check(`{{ a | plus: 1 | markdown }}`, filters))).toEqual([
      mismatch(`the value piped into 'markdown'`, 'string', 'number'),
    ]);
  });

  describe('a variadic parameter', () => {
    const digParameters = (variadic: boolean) => [
      parameter('hash', ['object'], { required: true }),
      parameter('keys', ['array'], { variadic }),
    ];

    it('says nothing about the arguments written for it', async () => {
      // The published type describes the collection it gathers, so each argument written at the call
      // site is an ELEMENT of it — `{{ h | hash_dig: 'a', 'b' }}` passes two strings, not an array.
      const filters = contractual(await withParameters('hash_dig', digParameters(true)));

      expect(messagesOf(await check(`{{ h | hash_dig: 'a', 'b' }}`, filters))).toEqual([]);
    });

    it('CONTROL: the same arguments are reported when the docset does not call it variadic', async () => {
      const filters = contractual(await withParameters('hash_dig', digParameters(false)));

      expect(messagesOf(await check(`{{ h | hash_dig: 'a', 'b' }}`, filters))).toEqual([
        mismatch(`argument 'keys' of 'hash_dig'`, 'array', 'string'),
      ]);
    });
  });

  it('matches a named argument by name rather than by position', async () => {
    const filters = contractual(
      await withParameters('format_number', [
        parameter('number', ['number'], { required: true }),
        parameter('options', ['untyped']),
        parameter('precision', ['number'], { positional: false }),
      ]),
    );

    expect(
      messagesOf(await check(`{{ 1000 | format_number: precision: 'two' }}`, filters)),
    ).toEqual([mismatch(`argument 'precision' of 'format_number'`, 'number', 'string')]);
  });

  it('suggests a default of the expected type for a written argument, and removal', async () => {
    const filters = contractual(
      await withParameters('format_number', [
        parameter('number', ['untyped'], { required: true }),
        parameter('precision', ['number'], { positional: false }),
      ]),
    );
    const source = `{{ 1000 | format_number: precision: 'two' }}`;
    const offenses = await check(source, filters);

    expect(offenses[0].suggest?.map((suggestion) => suggestion.message)).toEqual([
      "Replace with default value '0' for number",
      'Remove value',
    ]);
    expect(applySuggestions(source, offenses[0])).toEqual([
      `{{ 1000 | format_number: precision: 0 }}`,
      `{{ 1000 | format_number: precision:  }}`,
    ]);
  });

  describe('a parameter that names several types', () => {
    /** `strftime` takes a string, a number of seconds, a Date or a Time and raises on anything else. */
    const strftime = async () =>
      contractual(
        await withParameters('strftime', [
          parameter('time', ['string', 'number', 'date', 'time'], { required: true }),
          parameter('format', ['string'], { required: true }),
        ]),
      );

    it('accepts a value matching any one of them', async () => {
      const filters = await strftime();
      const accepted = [
        `{{ '2020-01-02' | strftime: '%Y' }}`,
        `{{ 1600000000 | strftime: '%Y' }}`,
        `{{ x | to_date | strftime: '%Y' }}`,
        `{{ x | to_time | strftime: '%Y' }}`,
      ];

      for (const source of accepted) {
        expect(messagesOf(await check(source, filters)), source).toEqual([]);
      }
    });

    it('reports a value matching none of them, naming every type it accepts', async () => {
      const filters = await strftime();

      expect(messagesOf(await check(`{{ h | hash_keys | strftime: '%Y' }}`, filters))).toEqual([
        mismatch(`the value piped into 'strftime'`, 'string, number, date or time', 'array'),
      ]);
    });
  });

  describe('`object` on a filter parameter', () => {
    it('refuses an array and a range, which are not Hashes', async () => {
      // Measured: `{{ [] | hash_add_key: 'hello', 'world' }}` and `{{ (1..3) | hash_add_key: 'a', 1 }}`
      // both raise `first argument must be a hash`, while `{% assign h = {} %}` piped in renders.
      // `isTypeCompatible` accepts an array and a range for `object` and would miss both.
      const filters = withSplit(await hashAddKey());

      expect(
        messagesOf(
          await check(`{{ 'a,b' | split: ',' | hash_add_key: 'hello', 'world' }}`, filters),
        ),
      ).toEqual([mismatch(`the value piped into 'hash_add_key'`, 'object', 'array')]);
      expect(
        messagesOf(await check(`{{ (1..3) | hash_add_key: 'hello', 'world' }}`, filters)),
      ).toEqual([mismatch(`the value piped into 'hash_add_key'`, 'object', 'range')]);
    });

    it('CONTROL: accepts an array where the docset names both', async () => {
      // `to_xml` and `www_form_encode` take either, and say so — that is what keeps the rule above
      // from refusing them.
      const filters = withSplit(
        contractual(
          await withParameters('to_xml', [
            parameter('object', ['object', 'array'], { required: true }),
          ]),
        ),
      );

      expect(messagesOf(await check(`{{ 'a,b' | split: ',' | to_xml }}`, filters))).toEqual([]);
      expect(messagesOf(await check(`{{ 'abc' | to_xml }}`, filters))).toEqual([
        mismatch(`the value piped into 'to_xml'`, 'object or array', 'string'),
      ]);
    });
  });

  it('offers no suggestion for a piped value, which it cannot rewrite', async () => {
    const offenses = await check(`{{ 123 | hash_add_key: 'hello', 'world' }}`, await hashAddKey());

    expect(offenses.map((offense) => offense.suggest)).toEqual([undefined]);
  });

  /**
   * The whole vocabulary, derived. Unlike a tag, every filter is called the same way — `value | name`
   * — so a wrong piped value can be written for each one mechanically, and a docs release that types
   * another input extends this rather than breaking it.
   */
  it('reports a wrong piped value for every filter whose input the docset types', async () => {
    const filters = contractual(await publishedDocset.filters());
    const subjects = filters.flatMap((entry) => {
      const input = entry.parameters?.[0];
      if (!input) return [];

      const type = docsetParameterType(input);
      // `boolean` accepts every value in `isTypeCompatible`, so nothing can contradict it.
      if (type === 'untyped' || type === 'boolean') return [];

      return [{ name: entry.name, type }];
    });

    // A docset that types no filter input would make the comparison below assert nothing.
    expect(subjects.map((subject) => subject.name)).not.toEqual([]);

    const reported = await Promise.all(
      subjects.map(async ({ name, type }) => ({
        name,
        messages: messagesOf(await check(`{{ ${wrongValueFor(type)} | ${name} }}`, filters)),
        expected: [mismatch(`the value piped into '${name}'`, type, wrongTypeFor(type))],
      })),
    );

    expect(reported.map(({ messages }) => messages)).toEqual(
      reported.map(({ expected }) => expected),
    );
  });
});

/**
 * A VARIABLE THIS FILE ASSIGNS, which used to be exempt from the whole check.
 */
describe('Module: ValidFilterArgumentTypes — a variable this file assigns', () => {
  /** The shipped document, with the marker that makes its types contracts. */
  const published = async () => contractual(await publishedDocset.filters());

  const messages = async (source: string) => messagesOf(await check(source, await published()));

  const pipedIntoT = (actual: string) => mismatch(`the value piped into 't'`, 'string', actual);

  it('reports an assigned value exactly as it reports the literal', async () => {
    // The two halves of the reported defect, asserted against each other rather than against a
    // string written twice: if the literal's message ever changes, the assigned one has to follow.
    expect([
      await messages(`{{ 403 | t }}`),
      await messages(`{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[pipedIntoT('number')], [pipedIntoT('number')]]);
  });

  it('says nothing when the assigned value is the type the filter wants', async () => {
    // CONTROL for the case above: the fixture differs only in the literal, so the silence is caused
    // by the type and not by the shape of the source.
    expect([
      await messages(`{% assign x = 'a key' %}{{ x | t }}`),
      await messages(`{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')]]);
  });

  it('takes the type from the last assignment before the read, in both directions', async () => {
    expect([
      await messages(`{% assign x = 403 %}{% assign x = 'a' %}{{ x | t }}`),
      await messages(`{% assign x = 'a' %}{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')]]);
  });

  it('resolves a chain of assignments', async () => {
    expect([
      await messages(`{% assign a = 403 %}{% assign b = a %}{{ b | t }}`),
      await messages(`{% assign a = 'k' %}{% assign b = a %}{{ b | t }}`),
    ]).toEqual([[pipedIntoT('number')], []]);
  });

  it('resolves an assignment through a filter, from the published return type', async () => {
    // `size` returns `number` and `append` returns `string`, both read out of `filters.json` — the
    // assertion derives the pair rather than restating it, so a docs release cannot fail this.
    const returnTypes = new Map(
      (await published()).map((entry) => [entry.name, entry.return_type?.[0]?.type]),
    );
    expect([returnTypes.get('size'), returnTypes.get('append')]).toEqual(['number', 'string']);

    expect([
      await messages(`{% assign n = list | size %}{{ n | t }}`),
      await messages(`{% assign s = 'x' | append: 'y' %}{{ s | t }}`),
    ]).toEqual([[pipedIntoT('number')], []]);
  });

  it('does not carry an assignment out of the branch it was written in', async () => {
    // Nobody knows whether the branch ran, so past `{% endif %}` the name has no type. CONTROL: the
    // same write on the straight-line path still reports, so the silence is the branch and not the
    // check having gone quiet.
    expect([
      await messages(`{% assign x = 'a' %}{% if c %}{% assign x = 403 %}{% endif %}{{ x | t }}`),
      await messages(`{% if c %}{% assign x = 403 %}{{ x | t }}{% endif %}`),
      await messages(`{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')], [pipedIntoT('number')]]);
  });

  it('lets a loop variable shadow an assigned name, and restores it after', async () => {
    // `{% for x in … %}` rebinds `x` over the body; what the outer assignment held says nothing
    // about the item. CONTROL: the same read after `{% endfor %}` still reports.
    expect([
      await messages(`{% assign x = 403 %}{% for x in list %}{{ x | t }}{% endfor %}`),
      await messages(`{% assign x = 403 %}{% for i in list %}{% endfor %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')]]);
  });

  it('says nothing about a lookup INTO an assigned variable', async () => {
    // Nothing here tracks property types — `shape-analysis` is the model that does. CONTROL: the
    // same variable read plainly reports.
    expect([
      await messages(`{% assign x = 403 %}{{ x.y | t }}`),
      await messages(`{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')]]);
  });

  it('forgets everything when an assigning tag does not parse', async () => {
    // A tolerant parse leaves unreadable markup as a raw string, and it may have assigned anything.
    // CONTROL: the same file with the tag removed still reports.
    expect([
      await messages(`{% assign x = 403 %}{% assign %}{{ x | t }}`),
      await messages(`{% assign x = 403 %}{{ x | t }}`),
    ]).toEqual([[], [pipedIntoT('number')]]);
  });

  it('reports a captured variable, which is a string', async () => {
    // `capture` produces a string, so a `number` parameter contradicts it. CONTROL: piping the same
    // capture into `t`, which wants a string, is silent.
    const filters = await hashAddKey([
      parameter('hash', ['number'], { required: true }),
      parameter('key', ['string'], { required: true }),
      parameter('value', ['untyped'], { required: true }),
    ]);

    expect([
      messagesOf(
        await check(`{% capture s %}hi{% endcapture %}{{ s | hash_add_key: 'k', 1 }}`, filters),
      ),
      await messages(`{% capture s %}hi{% endcapture %}{{ s | t }}`),
    ]).toEqual([[mismatch(`the value piped into 'hash_add_key'`, 'number', 'string')], []]);
  });

  it('reads a parse_json body rather than assuming a Hash', async () => {
    // `[1,2]` is an Array and `{}` is a Hash. A single published type for the tag would be wrong for
    // one of them, so the type comes from the body — and a body with Liquid in it claims nothing.
    expect([
      await messages(`{% parse_json h %}{"a": 1}{% endparse_json %}{{ h | t }}`),
      await messages(`{% parse_json a %}[1, 2]{% endparse_json %}{{ a | t }}`),
      await messages(`{% parse_json u %}{{ whatever }}{% endparse_json %}{{ u | t }}`),
    ]).toEqual([[pipedIntoT('object')], [pipedIntoT('array')], []]);
  });

  it('types a counter, but only where nothing else binds the name', async () => {
    // Measured against a live instance: `{% increment c %}{{ c }}` renders `1`, while
    // `{% assign d = 'str' %}{% increment d %}{{ d }}` renders `str` — an assigned variable shadows
    // the counter namespace whichever order the two are written in.
    expect([
      await messages(`{% increment c %}{{ c | t }}`),
      await messages(`{% assign c = 'a' %}{% increment c %}{{ c | t }}`),
    ]).toEqual([[pipedIntoT('number')], []]);
  });

  it('takes a {% doc %} @param as the type of that name inside the partial', async () => {
    // The contract `ValidRenderPartialArgumentTypes` already enforces at every call site, enforced
    // on the callee's side too. CONTROL: a declared `string` is silent, and an assignment still
    // overrides the declaration from its own offset.
    const doc = (type: string) => `{% doc %}\n  @param {${type}} title\n{% enddoc %}`;

    expect([
      await messages(`${doc('number')}{{ title | t }}`),
      await messages(`${doc('string')}{{ title | t }}`),
      await messages(`${doc('string')}{% assign title = 403 %}{{ title | t }}`),
    ]).toEqual([[pipedIntoT('number')], [], [pipedIntoT('number')]]);
  });

  it('says nothing for a declared type the docset vocabulary does not map', async () => {
    // `{current_user}` and `{string[]}` are declarable in a `{% doc %}` block and nothing here knows
    // what satisfies either. CONTROL: a type it does map still reports.
    const doc = (type: string) => `{% doc %}\n  @param {${type}} title\n{% enddoc %}`;

    expect([
      await messages(`${doc('current_user')}{{ title | t }}`),
      await messages(`${doc('string[]')}{{ title | t }}`),
      await messages(`${doc('number')}{{ title | t }}`),
    ]).toEqual([[], [], [pipedIntoT('number')]]);
  });
});
