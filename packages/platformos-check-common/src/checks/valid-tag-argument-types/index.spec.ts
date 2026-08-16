import { describe, expect, it } from 'vitest';

import { publishedDocset } from '../../test/published-docset';
import { applySuggestions, messagesOf, runLiquidCheck } from '../../test';
import { tagParameterTypes } from '../../liquid-types';
import { TagEntry } from '../../types';
import { ValidTagArgumentTypes } from './index';

/** The argument types the docset resolves for one tag, as a plain object for a whole-value assert. */
const typesOf = (tags: TagEntry[], name: string) => {
  const parameters = tagParameterTypes(tags).get(name);
  return parameters && Object.fromEntries(parameters);
};

/**
 * AGAINST THE SHIPPED `tags.json`. The point of this check is that it says only what the platform
 * publishes, so the published document is the input — a declared docset would measure agreement
 * with whoever wrote the mock.
 */
const check = (source: string) => runLiquidCheck(ValidTagArgumentTypes, source);

/** Every tag argument the shipped documents give a type, derived rather than restated. */
const typedParameters = async () => {
  const tags = await publishedDocset.tags();
  return tags.flatMap((tag) =>
    (tag.parameters ?? [])
      .filter((parameter) => parameter.types.some((type) => type !== 'untyped'))
      .map((parameter) => ({ tag: tag.name, parameter: parameter.name, types: parameter.types })),
  );
};

/**
 * A call this spec can legally write, per tag, with the argument under test in it.
 *
 * HAND-WRITTEN, and the one thing here that is: a tag's MARKUP is grammar, and `tags.json` publishes
 * types rather than how to spell a call — `{% session variable: 'x' %}` parses no named argument at
 * all, so a generated `{% <tag> <name>: <value> %}` proves nothing about most tags. WHICH pairs run
 * is still derived: only the ones the shipped document types.
 *
 * A tag missing from here is not skipped silently — `covers every typed argument the docset publishes`
 * measures the whole vocabulary against the table the check reads.
 */
const CALLS: Record<string, (parameter: string, value: string) => string> = {
  for: (parameter, value) => `{% for x in y ${parameter}: ${value} %}{% endfor %}`,
  tablerow: (parameter, value) => `{% tablerow x in y ${parameter}: ${value} %}{% endtablerow %}`,
  cache: (parameter, value) => `{% cache 'k', ${parameter}: ${value} %}body{% endcache %}`,
  log: (parameter, value) => `{% log 'msg', ${parameter}: ${value} %}`,
  redirect_to: (parameter, value) => `{% redirect_to '/x', ${parameter}: ${value} %}`,
};

/** A literal of the wrong type for `type`, and the name the check gives what it read. */
const wrongValueFor = (type: string) => (type === 'string' ? '5' : `'nope'`);
const wrongTypeFor = (type: string) => (type === 'string' ? 'number' : 'string');

/** The typed pairs {@link CALLS} can write a call for. */
const exercisableParameters = async () => {
  const published = await typedParameters();

  return published
    .filter(({ tag }) => tag in CALLS)
    .map(({ tag, parameter, types }) => ({ tag, parameter, type: types[0] }));
};

/** The shipped tags with ONE parameter's type emptied — what a docset that does not say looks like. */
const withoutTypeFor = async (tagName: string, parameterName: string): Promise<TagEntry[]> => {
  const tags = await publishedDocset.tags();

  return tags.map((tag) =>
    tag.name === tagName
      ? {
          ...tag,
          parameters: (tag.parameters ?? []).map((parameter) =>
            parameter.name === parameterName ? { ...parameter, types: ['untyped'] } : parameter,
          ),
        }
      : tag,
  );
};

describe('Module: ValidTagArgumentTypes', () => {
  it('reports a literal that contradicts the published type', async () => {
    // One real attribute, spelled out, so the mechanism is shown firing before anything derived runs.
    expect(messagesOf(await check(`{% for x in y limit: 'ten' %}{% endfor %}`))).toEqual([
      "Type mismatch for argument 'limit' in for tag: expected number, got string",
    ]);
  });

  it('reports every typed argument the docset publishes, on the tag that publishes it', async () => {
    // Derived from the shipped file, value and message both: a docs release that types another
    // attribute extends this test rather than breaking it.
    const pairs = await exercisableParameters();

    const reported = await Promise.all(
      pairs.map(async ({ tag, parameter, type }) => ({
        tag,
        parameter,
        messages: messagesOf(await check(CALLS[tag](parameter, wrongValueFor(type)))),
        expected: [
          `Type mismatch for argument '${parameter}' in ${tag} tag: expected ${type}, got ${wrongTypeFor(
            type,
          )}`,
        ],
      })),
    );

    expect(reported.map(({ messages }) => messages)).toEqual(
      reported.map(({ expected }) => expected),
    );
    // The docset really does type something; without this the loop above can pass on an empty list.
    expect(reported.length === 0).toBe(false);
  });

  it('covers every typed argument the docset publishes, spellable here or not', async () => {
    // The end-to-end sweep above can only reach the tags `CALLS` spells. This reaches all of them:
    // the table the check consults must carry every type the document publishes, so a tag whose
    // markup this spec cannot write is still not quietly uncovered.
    const published = await typedParameters();
    const table = tagParameterTypes(await publishedDocset.tags());

    expect(
      published.map(
        ({ tag, parameter }) => `${tag}.${parameter}=${table.get(tag)?.get(parameter)}`,
      ),
    ).toEqual(published.map(({ tag, parameter, types }) => `${tag}.${parameter}=${types[0]}`));
    expect(published.length === 0).toBe(false);
  });

  it('accepts a value of the published type', async () => {
    expect(messagesOf(await check(`{% for x in y limit: 2, offset: 1 %}{% endfor %}`))).toEqual([]);
  });

  it('accepts a filtered value whose last filter publishes the published type', async () => {
    // `size` publishes `return_type: number`, so the chain resolves without a symbol table.
    expect(messagesOf(await check(`{% for x in y limit: z | size %}{% endfor %}`))).toEqual([]);
  });

  it('says nothing about a bare variable, which has no type at a tag', async () => {
    expect(messagesOf(await check(`{% for x in y limit: page_size %}{% endfor %}`))).toEqual([]);
  });

  it('says nothing about nil, which is no value rather than a wrong one', async () => {
    expect(messagesOf(await check(`{% for x in y limit: nil %}{% endfor %}`))).toEqual([]);
  });

  it('suggests a default of the expected type, and removal', async () => {
    const offenses = await check(`{% for x in y limit: 'ten' %}{% endfor %}`);

    expect(offenses[0].suggest?.map((suggestion) => suggestion.message)).toEqual([
      "Replace with default value '0' for number",
      'Remove value',
    ]);
    expect(applySuggestions(`{% for x in y limit: 'ten' %}{% endfor %}`, offenses[0])).toEqual([
      `{% for x in y limit: 0 %}{% endfor %}`,
      `{% for x in y limit:  %}{% endfor %}`,
    ]);
  });

  describe('an argument the docset types `untyped`', () => {
    /**
     * The pair is CHOSEN by the shipped document rather than named here, and the docset is that
     * document with its ONE type emptied. Naming a parameter that happened to be untyped is how this
     * pair came to fail on a docs release that typed it — an assertion about the documentation, not
     * about the check.
     */
    const subject = async () => {
      const [first] = await exercisableParameters();
      return first;
    };

    it('is not reported, whatever is passed to it', async () => {
      const { tag, parameter, type } = await subject();
      const tags = await withoutTypeFor(tag, parameter);

      const offenses = await runLiquidCheck(
        ValidTagArgumentTypes,
        CALLS[tag](parameter, wrongValueFor(type)),
        undefined,
        { platformosDocset: { ...publishedDocset, tags: async () => tags } },
      );

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('CONTROL: the same fixture reports against the shipped docset, which types it', async () => {
      // Without this, the silence above passes with the whole mechanism deleted — and would keep
      // passing if the tag's arguments never reached the check at all.
      const { tag, parameter, type } = await subject();

      expect(messagesOf(await check(CALLS[tag](parameter, wrongValueFor(type))))).toEqual([
        `Type mismatch for argument '${parameter}' in ${tag} tag: expected ${type}, got ${wrongTypeFor(
          type,
        )}`,
      ]);
    });
  });

  describe('a tag name the docset publishes twice', () => {
    it('keeps what each row publishes, whichever order they arrive in', async () => {
      // `tags.json` ships two entries named `else` and has no merge upstream, so a last-wins reduce
      // would make whichever row the docs site lists second the whole answer. Both orders, one
      // assertion: asserting a single order would pass on the broken reduce for exactly one of the
      // two files the site might serve.
      const typed: TagEntry = {
        name: 'twin',
        parameters: [{ name: 'a', description: '', required: false, types: ['number'] }],
      };
      const alsoTyped: TagEntry = {
        name: 'twin',
        parameters: [{ name: 'b', description: '', required: false, types: ['string'] }],
      };
      const untyped: TagEntry = {
        name: 'twin',
        parameters: [{ name: 'a', description: '', required: false, types: ['untyped'] }],
      };

      expect({
        bothOrders: [typesOf([typed, alsoTyped], 'twin'), typesOf([alsoTyped, typed], 'twin')],
        // A row that says nothing must not erase a row that does, in either position.
        untypedDoesNotErase: [typesOf([typed, untyped], 'twin'), typesOf([untyped, typed], 'twin')],
      }).toEqual({
        bothOrders: [
          { a: 'number', b: 'string' },
          { a: 'number', b: 'string' },
        ],
        untypedDoesNotErase: [{ a: 'number' }, { a: 'number' }],
      });
    });

    it('leaves a parameter two rows disagree about with no type at all', async () => {
      // A contradiction is not a fact, and picking one of the two by position is how an editor
      // starts reporting working code on one docs release and not the next.
      const asNumber: TagEntry = {
        name: 'twin',
        parameters: [{ name: 'a', description: '', required: false, types: ['number'] }],
      };
      const asString: TagEntry = {
        name: 'twin',
        parameters: [{ name: 'a', description: '', required: false, types: ['string'] }],
      };

      expect([
        typesOf([asNumber, asString], 'twin'),
        typesOf([asString, asNumber], 'twin'),
      ]).toEqual([undefined, undefined]);
    });

    it('CONTROL: the shipped tags.json really does publish a duplicate name', async () => {
      const names = (await publishedDocset.tags()).map((tag) => tag.name);
      const duplicated = names.filter((name, index) => names.indexOf(name) !== index);

      expect(duplicated.length === 0).toBe(false);
    });
  });

  it('is silent for a tag the docset publishes no parameters for', async () => {
    // 30 of the 57 published tags publish no `parameters` at all, so `tagParameterTypes` gives them
    // no row, and no row means nothing is reported however the tag is written. `assign` is one of
    // them — asserted from the document rather than assumed, since being in that set is the whole
    // reason the fixture below is silent.
    const typed = tagParameterTypes(await publishedDocset.tags());

    expect([...typed.keys()].includes('assign')).toBe(false);
    expect(messagesOf(await check(`{% assign a = 1 %}{% assign b = 'two' %}`))).toEqual([]);
  });
});

/**
 * A VARIABLE THE FILE ASSIGNS, which used to be exempt from this check entirely.
 *
 * `{% for x in y limit: 'nope' %}` was reported and `{% assign n = 'nope' %}{% for x in y limit: n %}`
 * was not, on the stated grounds that a tag has no symbol table beside it. `for.limit` is published
 * `number` — read out of `tags.json` below rather than restated — so a string contradicts it.
 */
describe('Module: ValidTagArgumentTypes — a variable this file assigns', () => {
  const mismatch = (name: string, tag: string, expected: string, actual: string) =>
    `Type mismatch for argument '${name}' in ${tag} tag: expected ${expected}, got ${actual}`;

  const limitIsNumber = async () =>
    typesOf(await publishedDocset.tags(), 'for')?.limit === 'number';

  it('reports an assigned value exactly as it reports the literal', async () => {
    // Guarded on the document: if `for.limit` ever stops being published `number`, this case is
    // measuring nothing and says so rather than passing vacuously.
    expect(await limitIsNumber()).toBe(true);

    expect([
      messagesOf(await check(`{% for x in y limit: 'nope' %}{% endfor %}`)),
      messagesOf(await check(`{% assign n = 'nope' %}{% for x in y limit: n %}{% endfor %}`)),
    ]).toEqual([
      [mismatch('limit', 'for', 'number', 'string')],
      [mismatch('limit', 'for', 'number', 'string')],
    ]);
  });

  it('says nothing when the assigned value is the published type', async () => {
    // CONTROL for the case above: the fixtures differ only in the assigned literal.
    expect([
      messagesOf(await check(`{% assign n = 5 %}{% for x in y limit: n %}{% endfor %}`)),
      messagesOf(await check(`{% assign n = 'nope' %}{% for x in y limit: n %}{% endfor %}`)),
    ]).toEqual([[], [mismatch('limit', 'for', 'number', 'string')]]);
  });

  it('says nothing about a name the file never assigns', async () => {
    // The behaviour every variable argument used to get. CONTROL: the assigned spelling reports.
    expect([
      messagesOf(await check(`{% for x in y limit: page_size %}{% endfor %}`)),
      messagesOf(
        await check(`{% assign page_size = 'nope' %}{% for x in y limit: page_size %}{% endfor %}`),
      ),
    ]).toEqual([[], [mismatch('limit', 'for', 'number', 'string')]]);
  });
});
