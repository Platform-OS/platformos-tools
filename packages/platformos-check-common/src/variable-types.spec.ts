import { describe, expect, it } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';

import { buildVariableTypes, VariableTypeSources, variableTypeSources } from './variable-types';
import { publishedDocset } from './test/published-docset';
import { LiquidType } from './liquid-types';

/**
 * THE TABLE ITSELF, away from any check that reads it.
 *
 * The four consumers can only show that a type reached a message. What a name holds at an OFFSET —
 * which is the whole subject — is only visible here, and the scope rules (a branch, a loop, a tag
 * that did not parse) have no expression in an offense at all.
 */
const MARKER = '‸';

/**
 * The type of `name` where the marker sits, or at the end of the file when there is none.
 */
const typeOf = async (
  name: string,
  marked: string,
  sources?: VariableTypeSources,
): Promise<LiquidType> => {
  const at = marked.includes(MARKER) ? marked.indexOf(MARKER) : marked.length;
  const table = await buildVariableTypes(toLiquidHtmlAST(marked.split(MARKER).join('')));

  return table.typeAt(name, at, sources ?? (await variableTypeSources(publishedDocset)));
};

describe('Module: variableTypes — what a literal assigns', () => {
  it('reads every literal form the language writes', async () => {
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 403 %}`),
        typeOf('x', `{% assign x = 'a' %}`),
        typeOf('x', `{% assign x = true %}`),
        typeOf('x', `{% assign x = (1..5) %}`),
        typeOf('x', `{% assign x = [1, 2] %}`),
        typeOf('x', `{% assign x = {"a": 1} %}`),
        typeOf('x', `{% assign x = 1 > 2 %}`),
      ]),
    ).toEqual(['number', 'string', 'boolean', 'range', 'array', 'object', 'boolean']);
  });

  it('says nothing for the literals whose value depends on what they meet', async () => {
    // `nil`, `empty` and `blank` compare equal to several different things, and this answer is read
    // as a fact about a container. CONTROL: `false` is a boolean and does resolve.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = nil %}`),
        typeOf('x', `{% assign x = empty %}`),
        typeOf('x', `{% assign x = blank %}`),
        typeOf('x', `{% assign x = false %}`),
      ]),
    ).toEqual(['untyped', 'untyped', 'untyped', 'boolean']);
  });

  it('says nothing about a name the file never binds', async () => {
    expect(await typeOf('x', `{{ y }}`)).toEqual('untyped');
  });
});

describe('Module: variableTypes — what the docset decides', () => {
  it('takes a filtered assignment from the last filter published return type', async () => {
    // DERIVED from `filters.json` rather than restated: the pair is read out of the document first,
    // so a docs release that changes either cannot fail this on a correctness it did not break.
    const filters = await publishedDocset.filters();
    const returns = (name: string) =>
      filters.find((entry) => entry.name === name)?.return_type?.[0]?.type;

    expect([returns('size'), returns('append')]).toEqual(['number', 'string']);

    expect(
      await Promise.all([
        typeOf('x', `{% assign x = list | size %}`),
        typeOf('x', `{% assign x = 'a' | append: 'b' %}`),
        // THE LAST filter decides; every earlier one is input to the next.
        typeOf('x', `{% assign x = 'a' | append: 'b' | size %}`),
      ]),
    ).toEqual(['number', 'string', 'number']);
  });

  it('says nothing for a filter the docset has never heard of', async () => {
    // A module's own filter, or anything newer than the downloaded docset. CONTROL: a published one
    // in the same position resolves.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 'a' | some_module_filter %}`),
        typeOf('x', `{% assign x = 'a' | size %}`),
      ]),
    ).toEqual(['untyped', 'number']);
  });

  it('lets tags.json override the measured fallback for a tag', async () => {
    // THE DOCSET FIRST: a `@return` annotation published upstream decides, and retires the row this
    // repository measured. Stated with a synthetic document because the shipped one publishes `[]`
    // for every tag — asserting THAT would be asserting what the docset says, which is upstream's
    // gate and not this repository's.
    const published: VariableTypeSources = {
      filters: new Map(),
      tags: new Map<string, LiquidType>([['capture', 'array']]),
    };

    expect([
      await typeOf('s', `{% capture s %}hi{% endcapture %}`, published),
      await typeOf('s', `{% capture s %}hi{% endcapture %}`),
    ]).toEqual(['array', 'string']);
  });
});

describe('Module: variableTypes — what a tag assigns', () => {
  it('types the tags that bind a name', async () => {
    expect(
      await Promise.all([
        typeOf('s', `{% capture s %}hi{% endcapture %}`),
        typeOf('r', `{% graphql r %}query { a }{% endgraphql %}`),
        typeOf('d', `{% function d = 'lib/x' %}`),
      ]),
    ).toEqual(['string', 'object', 'untyped']);
  });

  it('reads a parse_json body rather than assuming a Hash', async () => {
    // A single published type would be wrong for one of the first two rows. The third claims
    // nothing: dropping an interpolation leaves a DIFFERENT document than the one that runs.
    expect(
      await Promise.all([
        typeOf('h', `{% parse_json h %}{"a": 1}{% endparse_json %}`),
        typeOf('a', `{% parse_json a %}[1, 2]{% endparse_json %}`),
        typeOf('u', `{% parse_json u %}{{ whatever }}{% endparse_json %}`),
      ]),
    ).toEqual(['object', 'array', 'untyped']);
  });

  it('types a counter only where nothing else binds the name', async () => {
    // Measured against a live instance: `{% increment c %}{{ c }}` renders `1`, while an assigned
    // variable shadows the counter whichever order the two are written in. A `{% function %}` binds
    // a value this table cannot type and still shadows — its slot holds no type, not no binding.
    expect(
      await Promise.all([
        typeOf('c', `{% increment c %}`),
        typeOf('c', `{% decrement c %}`),
        typeOf('c', `{% assign c = 'a' %}{% increment c %}`),
        typeOf('c', `{% function c = 'lib/x' %}{% increment c %}`),
        // An assignment LATER does not shadow the read before it — measured, `1`.
        typeOf('c', `{% increment c %}‸{% assign c = 'a' %}`),
      ]),
    ).toEqual(['number', 'number', 'string', 'untyped', 'number']);
  });
});

describe('Module: variableTypes — writes that go INTO a container', () => {
  it('narrows rather than rebinding, so the container keeps its kind', async () => {
    // A subscript write and an append leave the container in place. Rebinding it to the WRITTEN
    // value's type is a false block: the next write onto the same hash looks like a write onto a
    // string. A write that reached the runtime also PROVES the container's kind, so an unknown one
    // becomes what the operation requires.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = {} %}{% assign x['k'] = 'v' %}`),
        typeOf('x', `{% assign x['k'] = 'v' %}`),
        typeOf('x', `{% assign x << 'v' %}`),
        typeOf('x', `{% assign x = [1] %}{% assign x[0] = 'v' %}`),
        typeOf('x', `{% hash_assign x['k'] = 'v' %}`),
      ]),
    ).toEqual(['object', 'object', 'array', 'array', 'object']);
  });

  it('lets the subscript win over the operator', async () => {
    // `{% assign x['k'] << 'v' %}` appends to the value AT the key, so `x` stays the Hash it was.
    // Reading the `<<` first made it an Array. CONTROL: the same append with no subscript is one.
    expect([
      await typeOf('x', `{% assign x = {} %}{% assign x['k'] << 'v' %}`),
      await typeOf('x', `{% assign x = {} %}{% assign x << 'v' %}`),
    ]).toEqual(['object', 'array']);
  });
});

describe('Module: variableTypes — where a binding reaches', () => {
  it('takes the last write before the position, and no later one', async () => {
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 403 %}{% assign x = 'a' %}`),
        typeOf('x', `{% assign x = 403 %}‸{% assign x = 'a' %}`),
      ]),
    ).toEqual(['string', 'number']);
  });

  it('starts a binding at the offset the defining tag ends, INCLUSIVELY', async () => {
    // Liquid tags may abut with nothing between them, so a range's start is an offset a real tag
    // can begin at exactly. An exclusive bound made the check silent on the buffer an author
    // naturally writes and loud on the same code with one space inserted.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 403 %}‸{% hash_assign x['k'] = 'v' %}`),
        typeOf('x', `{% assign x = 403 %} ‸{% hash_assign x['k'] = 'v' %}`),
      ]),
    ).toEqual(['number', 'number']);
  });

  it('reads an operand against what preceded the tag it is written in', async () => {
    // `{% assign x = x %}` must see the FIRST binding, not the one it is defining — which is also
    // what stops the resolution cycling.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 403 %}{% assign x = x %}`),
        typeOf('x', `{% assign x = x %}`),
        typeOf('b', `{% assign a = 403 %}{% assign b = a %}`),
        typeOf('c', `{% assign a = 403 %}{% assign b = a %}{% assign c = b %}`),
      ]),
    ).toEqual(['number', 'untyped', 'number', 'number']);
  });

  it('says nothing about a lookup INTO a bound name', async () => {
    // Property types belong to `shape-analysis`, which is the model that tracks them.
    expect(
      await Promise.all([
        typeOf('y', `{% assign x = {"y": 1} %}{% assign y = x.y %}`),
        typeOf('y', `{% assign x = {"y": 1} %}{% assign y = x %}`),
      ]),
    ).toEqual(['untyped', 'object']);
  });

  it('does not carry a write out of the branch it sits in', async () => {
    // Past the `{% endif %}` nobody knows whether the write ran, so nobody knows the type. Inside
    // the branch it is a fact, and a straight-line write is a fact everywhere after it.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 'a' %}{% if c %}{% assign x = 403 %}{% endif %}`),
        typeOf('x', `{% if c %}{% assign x = 403 %}‸{{ x }}{% endif %}`),
        typeOf('x', `{% if c %}{% assign x = 403 %}{% else %}{% assign x = 'a' %}{% endif %}`),
        typeOf('x', `{% assign x = 403 %}{% if c %}‸{{ x }}{% endif %}`),
      ]),
    ).toEqual(['untyped', 'number', 'untyped', 'number']);
  });

  it('shadows a name over a loop body and gives it back afterwards', async () => {
    // Liquid scopes the loop variable, so past `{% endfor %}` the name means what it did before.
    // Without the shadow, `{{ x | t }}` inside the body is judged against the OUTER value.
    expect(
      await Promise.all([
        typeOf('x', `{% assign x = 403 %}{% for x in list %}‸{{ x }}{% endfor %}`),
        typeOf('x', `{% assign x = 403 %}{% for x in list %}{% endfor %}`),
        typeOf('x', `{% assign x = 403 %}{% tablerow x in list %}‸{{ x }}{% endtablerow %}`),
        typeOf('x', `{% assign x = 403 %}{% for i in list %}‸{{ x }}{% endfor %}`),
      ]),
    ).toEqual(['untyped', 'number', 'untyped', 'number']);
  });

  it('forgets every binding when an assigning tag does not parse', async () => {
    // The tolerant parser keeps unreadable markup as a raw string, and it may have assigned
    // anything. CONTROL: a tag that is not an assigning one changes nothing.
    expect(
      await Promise.all([
        // The marker sits ON the lookup, which is where a consumer queries — the offset the
        // unreadable tag ENDS at is the one the forgotten range closes at, and no lookup is there.
        typeOf('x', `{% assign x = 403 %}{% assign %}{{ ‸x }}`),
        typeOf('x', `{% assign x = 403 %}{% if %}{% endif %}{{ ‸x }}`),
      ]),
    ).toEqual(['untyped', 'number']);
  });
});

describe('Module: variableTypes — what a {% doc %} block declares', () => {
  const doc = (type: string) => `{% doc %}\n  @param {${type}} title\n{% enddoc %}`;

  it('binds a declared parameter for the whole file', async () => {
    expect(
      await Promise.all([
        typeOf('title', doc('string')),
        typeOf('title', doc('number')),
        typeOf('title', `${doc('string')}‸{{ title }}`),
      ]),
    ).toEqual(['string', 'number', 'string']);
  });

  it('binds nothing for a declared type the docset vocabulary does not map', async () => {
    // `{current_user}` and `{string[]}` are declarable and nothing here knows what satisfies
    // either. CONTROL: a type it does map binds.
    expect(
      await Promise.all([
        typeOf('title', doc('current_user')),
        typeOf('title', doc('string[]')),
        typeOf('title', doc('object')),
      ]),
    ).toEqual(['untyped', 'untyped', 'object']);
  });

  it('lets an assignment override the declaration from its own offset', async () => {
    expect(
      await Promise.all([
        typeOf('title', `${doc('string')}{% assign title = 403 %}`),
        typeOf('title', `${doc('string')}‸{% assign title = 403 %}`),
      ]),
    ).toEqual(['number', 'string']);
  });
});
