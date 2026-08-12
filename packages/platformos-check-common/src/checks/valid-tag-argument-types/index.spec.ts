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

describe('Module: ValidTagArgumentTypes', () => {
  it('reports a literal that contradicts the published type', async () => {
    // `limit` is published `number` — the ONE real attribute in the file that can prove the
    // mechanism fires at all.
    expect(messagesOf(await check(`{% for x in y limit: 'ten' %}{% endfor %}`))).toEqual([
      "Type mismatch for argument 'limit' in for tag: expected number, got string",
    ]);
  });

  it('reports every typed argument the docset publishes, on the tag that publishes it', async () => {
    // Derived from the shipped file: whatever it types, a string is wrong for. A docs release that
    // types another attribute extends this test rather than breaking it.
    const published = await typedParameters();
    const closing: Record<string, string> = { for: '{% endfor %}', tablerow: '{% endtablerow %}' };

    const reported = await Promise.all(
      published.map(async ({ tag, parameter, types }) => {
        const source = `{% ${tag} x in y ${parameter}: 'nope' %}${closing[tag] ?? ''}`;
        return {
          tag,
          parameter,
          messages: messagesOf(await check(source)),
          expected: [
            `Type mismatch for argument '${parameter}' in ${tag} tag: expected ${types[0]}, got string`,
          ],
        };
      }),
    );

    expect(reported.map(({ messages }) => messages)).toEqual(
      reported.map(({ expected }) => expected),
    );
    // The docset really does type something; without this the loop above can pass on an empty list.
    expect(reported.length === 0).toBe(false);
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
    it('is not reported, whatever is passed to it', async () => {
      // 67 of the 72 published tag parameters are `untyped`. `cache`'s `expire` is one of them, and
      // a string where a duration belongs is exactly the mistake a type would catch — the silence
      // is the docset's answer, not this check's opinion.
      expect(messagesOf(await check(`{% cache 'k', expire: 'soon' %}body{% endcache %}`))).toEqual(
        [],
      );
    });

    it('CONTROL: the same fixture reports once the docset types the parameter', async () => {
      // Without this, the silence above passes with the whole mechanism deleted — and would keep
      // passing if the tag's arguments never reached the check at all.
      const tags: TagEntry[] = (await publishedDocset.tags()).map((tag) =>
        tag.name === 'cache'
          ? {
              ...tag,
              parameters: (tag.parameters ?? []).map((parameter) =>
                parameter.name === 'expire' ? { ...parameter, types: ['number'] } : parameter,
              ),
            }
          : tag,
      );

      const offenses = await runLiquidCheck(
        ValidTagArgumentTypes,
        `{% cache 'k', expire: 'soon' %}body{% endcache %}`,
        undefined,
        { platformosDocset: { ...publishedDocset, tags: async () => tags } },
      );

      expect(messagesOf(offenses)).toEqual([
        "Type mismatch for argument 'expire' in cache tag: expected number, got string",
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

  it('is silent for every tag the docset leaves untyped', async () => {
    // The whole typed vocabulary, derived: any tag outside it gets no row at all, so no argument
    // of it can be reported however it is written.
    const typed = tagParameterTypes(await publishedDocset.tags());

    expect(
      messagesOf(
        await check(
          `{% log 'msg', type: 5 %}{% background j = 'p', delay: 'soon' %}{% assign a = 1 %}`,
        ),
      ),
    ).toEqual([]);
    expect([...typed.keys()].includes('log')).toBe(false);
  });
});
