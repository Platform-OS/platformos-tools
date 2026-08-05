import { describe, it, expect } from 'vitest';
import { MockApp, RECORDS_SDL, dependenciesWithSchema, runLiquidCheck } from '../../test';
import { Dependencies } from '../../types';
import { UnknownProperty } from './index';

const withSchema = dependenciesWithSchema(RECORDS_SDL);

const messagesOf = (offenses: { message: string }[]) => offenses.map((offense) => offense.message);

/**
 * The reporter's chain, reduced: a page calls a query partial, the partial forwards an
 * argument into a `{% graphql %}` whose `@include` decides whether the field exists,
 * and that field's own fields come from a spread fragment.
 *
 * Whether `relation.r` exists is a property of the CALL, not of the query.
 */
const SEARCH_GRAPHQL = `query records($id: ID, $limit: Int!, $include_related: Boolean = false) {
  records(per_page: $limit, filter: { id: { value: $id } }) {
    results {
      id
      name: property(name: "name")
      r: related_record(join_on_property: "r_id") @include(if: $include_related) {
        ...record
      }
    }
  }
}

fragment record on Record {
  id
  slug: property(name: "slug")
}`;

/** The same query with `r` unconditional, to separate "excluded" from "never selected". */
const ALWAYS_RELATED_GRAPHQL = SEARCH_GRAPHQL.replace(' @include(if: $include_related)', '');

/** The same query with no `r` at all. */
const NO_RELATED_GRAPHQL = `query records($id: ID, $limit: Int!, $include_related: Boolean = false) {
  records(per_page: $limit, filter: { id: { value: $id } }) {
    results {
      id
      name: property(name: "name")
    }
  }
}`;

const FIND_BY_ID = `{% liquid
  if id == blank
    log 'ID cannot be blank', type: 'ERROR'
    return null
  endif

  graphql r = 'relationships/search', limit: 1, id: id, include_related: include_related
  return r.records.results.first
%}`;

/** Accepts `include_related` and forgets to forward it. */
const FIND_BY_ID_UNFORWARDED = `{% liquid
  graphql r = 'relationships/search', limit: 1, id: id
  return r.records.results.first
%}`;

/** One more hop: a partial whose whole job is to call the query partial. */
const FIND_FOR_PROFILE = `{% liquid
  function relation = 'queries/relationships/find_by_id', id: id, include_related: include_related
  return relation
%}`;

const app: MockApp = {
  'app/lib/queries/relationships/find_by_id.liquid': FIND_BY_ID,
  'app/lib/queries/relationships/find_by_id_unforwarded.liquid': FIND_BY_ID_UNFORWARDED,
  'app/lib/queries/relationships/find_for_profile.liquid': FIND_FOR_PROFILE,
  'app/graphql/relationships/search.graphql': SEARCH_GRAPHQL,
};

const runPage = (
  body: string,
  files: MockApp = app,
  dependencies: Partial<Dependencies> = withSchema,
) =>
  runLiquidCheck(
    UnknownProperty,
    `{% liquid\n  ${body}\n%}`,
    'app/views/pages/accept.liquid',
    dependencies,
    files,
  );

describe('Module: UnknownProperty — function return shapes', () => {
  it('should resolve the query shape through the partial when the argument is forwarded as true', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.id
  assign b = relation.name
  assign c = relation.r.slug`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should report a property the query does not select, once the shape is known', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.bogus`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'relation'."]);
  });

  it('should report the conditional field when the call site forwards false', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: false
  assign a = relation.r`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'relation'."]);
  });

  it('should report the conditional field when the argument is omitted and the query defaults it to false', async () => {
    const offenses = await runPage(`function relation = 'queries/relationships/find_by_id', id: 1
  assign a = relation.r`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'relation'."]);
  });

  it('should forward a boolean the page assigned to a variable', async () => {
    const included = await runPage(`assign flag = true
  function relation = 'queries/relationships/find_by_id', id: 1, include_related: flag
  assign a = relation.r.slug`);
    const excluded = await runPage(`assign flag = false
  function relation = 'queries/relationships/find_by_id', id: 1, include_related: flag
  assign a = relation.r`);

    expect({ included: messagesOf(included), excluded: messagesOf(excluded) }).toEqual({
      included: [],
      excluded: ["Unknown property 'r' on 'relation'."],
    });
  });

  it('should not guess a boolean the page cannot prove', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: context.params.related
  assign a = relation.r.slug`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should report the conditional field when the partial never forwards the argument', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id_unforwarded', id: 1, include_related: true
  assign a = relation.r`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'relation'."]);
  });

  it('should report a field the query does not select at all, however the argument is passed', async () => {
    const offenses = await runPage(
      `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.r`,
      { ...app, 'app/graphql/relationships/search.graphql': NO_RELATED_GRAPHQL },
    );
    expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'relation'."]);
  });

  it('should keep the object shape when another branch returns null', async () => {
    // `find_by_id` returns `null` before it returns the record, and the null branch
    // must not erase what the other branch proves.
    const offenses = await runPage(
      `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.r.slug
  assign b = relation.r.bogus`,
      { ...app, 'app/graphql/relationships/search.graphql': ALWAYS_RELATED_GRAPHQL },
    );
    expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'relation.r'."]);
  });

  it('should resolve through two call boundaries', async () => {
    const included =
      await runPage(`function relation = 'queries/relationships/find_for_profile', id: 1, include_related: true
  assign a = relation.r.slug`);
    const excluded =
      await runPage(`function relation = 'queries/relationships/find_for_profile', id: 1, include_related: false
  assign a = relation.r`);

    expect({ included: messagesOf(included), excluded: messagesOf(excluded) }).toEqual({
      included: [],
      excluded: ["Unknown property 'r' on 'relation'."],
    });
  });

  it('should answer size on a shape a partial returned, and still report an absent key', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign n = relation.size
  assign m = relation.count`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'count' on 'relation'."]);
  });

  it('should claim nothing when the partial does not exist', async () => {
    const offenses = await runPage(`function relation = 'queries/relationships/nope', id: 1
  assign a = relation.anything`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should claim nothing when the partial does not parse', async () => {
    const offenses = await runPage(
      `function relation = 'queries/broken', id: 1
  assign a = relation.anything`,
      { ...app, 'app/lib/queries/broken.liquid': '{% if %}{% endunless %}' },
    );
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should terminate on a recursive partial and claim nothing', async () => {
    const offenses = await runPage(
      `function relation = 'queries/recursive', id: 1
  assign a = relation.anything`,
      {
        ...app,
        'app/lib/queries/recursive.liquid': `{% liquid
  function inner = 'queries/recursive', id: id
  return inner
%}`,
      },
    );
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should claim nothing when the partial returns a value it cannot see into', async () => {
    const offenses = await runPage(
      `function relation = 'queries/opaque', id: 1
  assign a = relation.anything`,
      {
        ...app,
        'app/lib/queries/opaque.liquid': `{% liquid
  assign result = context.params | some_filter
  return result
%}`,
      },
    );
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should claim nothing when one branch returns an object and another a list', async () => {
    const offenses = await runPage(
      `function relation = 'queries/inconsistent', id: 1
  assign a = relation.anything`,
      {
        ...app,
        'app/lib/queries/inconsistent.liquid': `{% liquid
  if id == blank
    return []
  endif
  return {"id": 1}
%}`,
      },
    );
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should claim nothing when the result passes through a filter', async () => {
    const offenses =
      await runPage(`function relation = 'queries/relationships/find_by_id', id: 1, include_related: true | to_hash
  assign a = relation.bogus`);
    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should resolve a partial that returns a hash literal', async () => {
    const offenses = await runPage(
      `function object = 'commands/build', id: 1
  assign a = object.valid
  assign b = object.errors
  assign c = object.bogus`,
      {
        ...app,
        'app/lib/commands/build.liquid': `{% liquid
  return {"valid": true, "errors": {}}
%}`,
      },
    );
    expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'object'."]);
  });

  it('should withdraw "no such field" when the partial mutated through an alias', async () => {
    // `recalculate/build`, reduced: the partial writes onto the ITEMS of the collection it
    // was handed, through a `for` alias. Liquid hands out references, so those keys are
    // there at runtime — and nothing in this model saw them assigned.
    const files = {
      ...app,
      'app/lib/queries/recalculate.liquid': `{% liquid
  assign orders = object.results
  for order in orders
    hash_assign order['total_quantity'] = 1
  endfor
  return object
%}`,
      'app/lib/queries/passthrough.liquid': `{% liquid
  return object
%}`,
    };

    const mutating = await runPage(
      `assign data = {"results": [{"id": 1}]}
  function res = 'queries/recalculate', object: data
  assign a = res.results.first.total_quantity`,
      files,
    );
    const passthrough = await runPage(
      `assign data = {"results": [{"id": 1}]}
  function res = 'queries/passthrough', object: data
  assign a = res.results.first.total_quantity`,
      files,
    );

    expect({ mutating: messagesOf(mutating), passthrough: messagesOf(passthrough) }).toEqual({
      mutating: [],
      passthrough: ["Unknown property 'total_quantity' on 'res.results.first'."],
    });
  });

  it('should not treat include as a call boundary', async () => {
    // `include` shares the caller's scope instead of returning a value, so it neither
    // assigns a shape nor invalidates one.
    const offenses = await runPage(`assign x = {"a": 1}
  include 'queries/relationships/find_by_id', id: 1
  assign b = x.a
  assign c = x.b`);
    expect(messagesOf(offenses)).toEqual(["Unknown property 'b' on 'x'."]);
  });

  it('should answer per graphql document, not per partial source', async () => {
    // Same partial, same arguments, different query: a memoized analysis is only good
    // while everything it read still says what it said.
    const withField = await runPage(
      `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.r`,
    );
    const withoutField = await runPage(
      `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.r`,
      { ...app, 'app/graphql/relationships/search.graphql': NO_RELATED_GRAPHQL },
    );

    expect({ withField: messagesOf(withField), withoutField: messagesOf(withoutField) }).toEqual({
      withField: [],
      withoutField: ["Unknown property 'r' on 'relation'."],
    });
  });

  it('should claim nothing when no schema says results is a list', async () => {
    // Without the SDL, `results` is just an object, `results.first` resolves to
    // nothing, and the partial's return shape is unknown all the way up. Degrading to
    // silence is the whole point: the alternative is a claim nobody can back.
    const offenses = await runPage(
      `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.bogus`,
      app,
      {},
    );
    expect(messagesOf(offenses)).toEqual([]);
  });
});
