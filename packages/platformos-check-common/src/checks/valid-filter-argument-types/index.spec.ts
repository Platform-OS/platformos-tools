import { describe, expect, it } from 'vitest';

import { publishedDocset } from '../../test/published-docset';
import { applySuggestions, messagesOf, runLiquidCheck } from '../../test';
import { docsetParameterType, filterTypesAreContracts } from '../../liquid-types';
import { FilterEntry, Parameter } from '../../types';
import { ValidFilterArgumentTypes } from './index';

/**
 * AGAINST THE SHIPPED `filters.json`, transformed rather than replaced.
 *
 * The document is the INPUT here, and every fixture changes exactly one entry of it, because what
 * this check does depends on a property of the WHOLE document — whether it separates `object` (a
 * Hash) from `untyped` (several types accepted) — which no invented docset can model honestly.
 *
 * Stating the parameters a case is about is what makes these read the same before and after a docs
 * release: `hash_add_key.value` is published `object` today and `untyped` after the release that
 * separates the two senses, so a case that left it alone would report one offense or two depending
 * on the day. Restating what the document says is the mistake the sibling tag check's spec made.
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
 *
 * A filtered chain is how these cases get an array to pipe. An array LITERAL would now work too —
 * the grammar accepts `{{ [1,2] | size }}` since the drop head learned `liquidJsonArrayLiteral` —
 * but `split` is what these cases were written against and it keeps them about what they are about:
 * the document publishes its input as `object` today and `untyped` after the release that separates
 * the two senses, and neither is this case's subject.
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

  it('says nothing about a bare variable, which has no type at a filter call', async () => {
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
      //
      // The array arrives through `split`, whose published return type is `array`: an array LITERAL
      // cannot be the piped value in `{{ … }}` as far as this repository's grammar is concerned, even
      // though the platform accepts one — a separate gap, and not one this spec can wait for.
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
