import { describe, it, expect } from 'vitest';
import {
  MockApp,
  RECORDS_SDL,
  dependenciesWithSchema,
  messagesOf,
  runLiquidCheck,
} from '../../test';
import { Dependencies } from '../../types';
import { UnknownProperty } from './index';

const PAGE = 'app/views/pages/index.liquid';
const withSchema = dependenciesWithSchema(RECORDS_SDL);

/** The check over one page, with the RECORDS SDL loaded. */
const run = (
  source: string,
  files: MockApp = {},
  dependencies: Partial<Dependencies> = withSchema,
) => runLiquidCheck(UnknownProperty, source, PAGE, dependencies, files);

/**
 * The same with NO schema: what the check can say from the document alone, and the only
 * way to exercise a query whose root field `RECORDS_SDL` does not declare.
 */
const runBare = (source: string, files: MockApp = {}) => run(source, files, {});

/** A query narrow enough that an unselected key is reportable. */
const RECORDS_QUERY_APP: MockApp = {
  'app/graphql/q.graphql': `query q {
  records(per_page: 10) {
    results { id }
  }
}`,
};

describe('Module: UnknownProperty', () => {
  describe('JSON parsed from a string', () => {
    it('should verify every read against the parsed object', async () => {
      const offenses = await run(`{% assign a = '{"x": 5, "n": {"y": 1}}' | parse_json %}
{{ a.x }}
{{ a.n.y }}
{{ a.zzz }}
{{ a.n.zzz }}
{{ a.x.zzz }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'zzz' on 'a'.",
        "Unknown property 'zzz' on 'a.n'.",
        "Cannot access property 'zzz' on primitive value 'a.x'.",
      ]);
    });

    it('should navigate a parsed array by first, last, size and index', async () => {
      const offenses = await run(`{% assign a = '[{"x": 1}, {"x": 2}]' | parse_json %}
{{ a.first.x }}
{{ a.last.x }}
{{ a.size }}
{{ a[0].x }}
{{ a.first.zzz }}
{{ a[1].zzz }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'zzz' on 'a.first'.",
        "Unknown property 'zzz' on 'a.1'.",
      ]);
    });

    it('should claim nothing when the value is not a JSON literal it can read', async () => {
      const dynamicVariable = await run(`{{ some_dynamic_var.anything }}`);
      const notJson = await run(`{% assign a = 'not valid json' %}
{{ a.x }}`);
      const notALiteral = await run(`{% assign a = some_variable %}
{{ a.x }}`);
      const dynamicPath = await run(`{% assign a = '{"x": 1}' | parse_json %}
{% assign key = "x" %}
{{ a[key] }}`);

      expect({
        dynamicVariable: messagesOf(dynamicVariable),
        notJson: messagesOf(notJson),
        notALiteral: messagesOf(notALiteral),
        dynamicPath: messagesOf(dynamicPath),
      }).toEqual({
        dynamicVariable: [],
        notJson: [],
        notALiteral: [],
        dynamicPath: [],
      });
    });

    it('should follow a reassignment to the shape that is current at each read', async () => {
      const offenses = await run(`{% assign a = '{"x": 1}' | parse_json %}
{{ a.x }}
{% assign a = '{"y": 2}' | parse_json %}
{{ a.y }}
{{ a.x }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'x' on 'a'."]);
    });
  });

  describe('hash and array literals', () => {
    it('should verify a hash literal at every depth', async () => {
      const offenses = await run(`{% assign a = {x: 5, n: {y: 1}} %}
{{ a.x }}
{{ a.n.y }}
{{ a.zzz }}
{{ a.n.zzz }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'zzz' on 'a'.",
        "Unknown property 'zzz' on 'a.n'.",
      ]);
    });

    it('should read a bare key and a quoted key as the same key', async () => {
      const offenses = await run(`{% assign a = {x: 5, "y": 10, "outer": { "inner": 1 }} %}
{{ a.x }}
{{ a.y }}
{{ a.outer.inner }}
{{ a.zzz }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'zzz' on 'a'."]);
    });

    it('should navigate an array literal and verify its items', async () => {
      const offenses = await run(`{% assign a = [2, 3] %}
{% assign b = [{x: 1}, {x: 2}] %}
{{ a.first }}{{ a.last }}{{ a.size }}
{{ a[0] }}{{ a[1] }}
{{ b.first.x }}
{{ a.zzz }}
{{ b.first.zzz }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'zzz' on 'a'.",
        "Unknown property 'zzz' on 'b.first'.",
      ]);
    });

    it('should verify a read that is the VALUE of another assign', async () => {
      const offenses = await run(`{% assign a = {x: 5} %}
{% assign b = a.zzz %}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'zzz' on 'a'."]);
    });

    it('should track a deep literal down to the type of a nested array', async () => {
      const offenses = await run(`{% assign hash = { "a": { "b": { "c": ["foo", "bar"] } } } %}
{{ hash.a.b.c.size }}
{{ hash.a.b.c.first.size }}
{{ hash.a.b.c[0] }}
{{ hash.a.b.d }}
{{ hash.a.b.c.first.upcase }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'd' on 'hash.a.b'.",
        "Cannot access property 'upcase' on primitive value 'hash.a.b.c.first'.",
      ]);
    });
  });

  describe('{% parse_json %} blocks', () => {
    it('should verify reads against the block body', async () => {
      const offenses = await run(`{% parse_json data %}
{"name": "test", "value": 42, "user": {"name": "John"}}
{% endparse_json %}
{{ data.name }}
{{ data.value }}
{{ data.user.name }}
{{ data.missing }}
{{ data.user.email }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'missing' on 'data'.",
        "Unknown property 'email' on 'data.user'.",
      ]);
    });

    it('should claim nothing from a body with an interpolated value', async () => {
      // Dropping the `{{ … }}` leaves a document a tolerant parser still reads — one key
      // short of the truth, which is worse than no shape at all.
      const offenses = await run(`{% parse_json object %}
{
  "id":       {{ id | json }},
  "attempts": {{ attempts | json }},
  "kind": "login"
}
{% endparse_json %}
{{ object.id }}
{{ object.anything }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('{% graphql %} — the document alone', () => {
    it('should verify reads against the selection set', async () => {
      const offenses = await runBare(`{% graphql result %}
query {
  user {
    id
    name
    profile { firstName }
  }
}
{% endgraphql %}
{{ result.user.id }}
{{ result.user.name }}
{{ result.user.profile.firstName }}
{{ result.user.email }}
{{ result.user.profile.middleName }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'email' on 'result.user'.",
        "Unknown property 'middleName' on 'result.user.profile'.",
      ]);
    });

    it('should not know a field is a list without a schema', async () => {
      // `first` is not in the `users` selection, and nothing here says `users` is a list.
      const offenses = await runBare(`{% graphql result %}
query {
  users {
    id
  }
}
{% endgraphql %}
{{ result.users.first.anything }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'first' on 'result.users'."]);
    });

    it('should accept the errors guard without claiming what is under it', async () => {
      // A successful result carries NO `errors` key — measured on a live instance,
      // `{{ g | hash_keys }}` after a query selecting `users` is exactly `["users"]` — so
      // the field is optional: the guard is silent, and nothing under it is verifiable.
      const inline = await runBare(`{% graphql r %}
query { user { id } }
{% endgraphql %}
{% if r.errors %}{{ r.errors.first.message }}{{ r.errors.first.whatever }}{% endif %}
{{ r.user.bogus }}`);
      const mutation = await runBare(`{% graphql r %}
mutation ($id: ID!) {
  user: user_delete(id: $id) { id email }
}
{% endgraphql %}
{% unless r.errors %}ok{% endunless %}`);
      const fileBased = await runBare(`{% graphql r = 'my_query' %}
{% if r.errors %}{{ r.errors }}{% endif %}`);

      expect({
        inline: messagesOf(inline),
        mutation: messagesOf(mutation),
        fileBased: messagesOf(fileBased),
      }).toEqual({
        inline: ["Unknown property 'bogus' on 'r.user'."],
        mutation: [],
        fileBased: [],
      });
    });

    it('should claim nothing about a body that interpolates a selection', async () => {
      // `isPlainTextBlock`, for the reason `{% parse_json %}` states above: what is left
      // after dropping the output tags is a DIFFERENT document that still parses.
      const interpolated = await run(`{% graphql g %}
query { records { results { id {{ extra_selection }} } } }
{% endgraphql %}
{{ g.records.results.first.whatever_the_interpolation_selects }}`);
      const plainText = await run(`{% graphql g %}
query { records { results { id } } }
{% endgraphql %}
{{ g.records.results.first.whatever_the_interpolation_selects }}`);

      expect({
        interpolated: messagesOf(interpolated),
        plainText: messagesOf(plainText),
      }).toEqual({
        interpolated: [],
        plainText: [
          "Unknown property 'whatever_the_interpolation_selects' on 'g.records.results.first'.",
        ],
      });
    });

    it('should forget a shape a graphql tag replaced with a document it cannot read', async () => {
      const offenses = await run(`{% assign r = {"a": 1} %}
{% graphql r = 'no/such/query' %}
{{ r.a }}
{{ r.anything }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('{% graphql %} — fragment spreads', () => {
    it('should resolve the fields a spread contributes', async () => {
      const offenses = await runBare(`{% graphql g %}
query { records { results { id ...rec } } }
fragment rec on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}
{{ g.records.results.missing }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve a spread nested inside another fragment', async () => {
      const offenses = await runBare(`{% graphql g %}
query { records { results { ...outer } } }
fragment outer on Record { id ...inner }
fragment inner on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}
{{ g.records.results.missing }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve a spread inside a nested field selection', async () => {
      const offenses = await runBare(`{% graphql g %}
query { records { results { r: related_record { ...record } } } }
fragment record on Record { name avatar: related_record { url } }
{% endgraphql %}
{{ g.records.results.r.name }}
{{ g.records.results.r.avatar.url }}
{{ g.records.results.r.avatar.missing }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'missing' on 'g.records.results.r.avatar'.",
      ]);
    });

    it('should resolve the fields an inline fragment contributes', async () => {
      const offenses = await runBare(`{% graphql g %}
query { records { results { id ... on Record { name } } } }
{% endgraphql %}
{{ g.records.results.name }}
{{ g.records.results.missing }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve one fragment spread into two aliases of the same field', async () => {
      // The shape of `modules/community/relationships/search`: `l` and `r` both spread
      // `record`, and `record` reaches a nested selection of its own.
      const offenses = await runBare(`{% graphql g, include_related: true %}
query records($include_related: Boolean = false) {
  records {
    results {
      id
      l: related_record @include(if: $include_related) { ...record }
      r: related_record @include(if: $include_related) { ...record }
    }
  }
}

fragment record on Record {
  name
  avatar: related_record { photo: property_upload(name: "photo") { url } }
}
{% endgraphql %}
{{ g.records.results.l.name }}
{{ g.records.results.r.name }}
{{ g.records.results.l.avatar.photo.url }}
{{ g.records.results.r.avatar.photo.url }}
{{ g.records.results.r.avatar.photo.missing }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'missing' on 'g.records.results.r.avatar.photo'.",
      ]);
    });

    it('should terminate on a cyclic fragment pair and report nothing', async () => {
      const offenses = await runBare(`{% graphql g %}
query { records { results { ...a } } }
fragment a on Record { id ...b }
fragment b on Record { name ...a }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should leave the level OPEN when the fragment is not in the document, at every depth', async () => {
      // `inferShapeFromGraphQL` adds the top-level `errors` key to whatever the operation
      // selects, and must not lose the level's `open` marker while doing it. The nested
      // position was the only one the suite covered, which is how the root stayed broken.
      const atRoot = await run(`{% graphql g %}
query { ...defined_elsewhere }
{% endgraphql %}
{{ g.whatever_the_fragment_adds }}`);
      const nested = await run(`{% graphql g %}
query { records { results { id ...defined_elsewhere } } }
{% endgraphql %}
{{ g.records.results.first.whatever_the_fragment_adds }}
{{ g.reccords }}`);

      expect({ atRoot: messagesOf(atRoot), nested: messagesOf(nested) }).toEqual({
        atRoot: [],
        // The typo alongside it proves the level is still verified, not given up on.
        nested: ["Unknown property 'reccords' on 'g'."],
      });
    });
  });

  describe('{% graphql %} — @include / @skip', () => {
    const query = (directive: string) => `query q($flag: Boolean = false) {
  records { results { id r: related_record ${directive} { name } } }
}`;

    const withDirective = (directive: string, args = '') =>
      runBare(`{% graphql g${args} %}
${query(directive)}
{% endgraphql %}
{{ g.records.results.r.name }}`);

    it('should decide a conditional field from the argument the call site passes', async () => {
      const passedTrue = await withDirective('@include(if: $flag)', ', flag: true');
      const passedFalse = await withDirective('@include(if: $flag)', ', flag: false');
      const defaulted = await withDirective('@include(if: $flag)');
      const undeclared = await runBare(`{% graphql g %}
query q($flag: Boolean) {
  records { results { id r: related_record @include(if: $flag) { name } } }
}
{% endgraphql %}
{{ g.records.results.r.name }}`);

      const absent = ["Unknown property 'r' on 'g.records.results'."];
      expect({
        passedTrue: messagesOf(passedTrue),
        passedFalse: messagesOf(passedFalse),
        defaulted: messagesOf(defaulted),
        undeclared: messagesOf(undeclared),
      }).toEqual({
        passedTrue: [],
        // The query declares `= false`, so omitting the argument really does exclude it.
        passedFalse: absent,
        defaulted: absent,
        // No default and nothing passed: the value is nil, which is not provably either way.
        undeclared: [],
      });
    });

    it('should forward only a boolean the call site can prove', async () => {
      const assignedTrue = await runBare(`{% assign flag = true %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`);
      const assignedFalse = await runBare(`{% assign flag = false %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`);
      const unprovable = await runBare(`{% assign flag = some_variable %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`);

      expect({
        assignedTrue: messagesOf(assignedTrue),
        assignedFalse: messagesOf(assignedFalse),
        unprovable: messagesOf(unprovable),
      }).toEqual({
        assignedTrue: [],
        assignedFalse: ["Unknown property 'r' on 'g.records.results'."],
        unprovable: [],
      });
    });

    it('should treat @skip as the inverse of @include', async () => {
      const skipped = await withDirective('@skip(if: $flag)', ', flag: true');
      const kept = await withDirective('@skip(if: $flag)', ', flag: false');
      const defaulted = await withDirective('@skip(if: $flag)');

      expect({
        skipped: messagesOf(skipped),
        kept: messagesOf(kept),
        defaulted: messagesOf(defaulted),
      }).toEqual({
        skipped: ["Unknown property 'r' on 'g.records.results'."],
        kept: [],
        defaulted: [],
      });
    });

    it('should resolve a literal directive argument with no variable involved', async () => {
      const included = await withDirective('@include(if: true)');
      const excluded = await withDirective('@include(if: false)');

      expect({ included: messagesOf(included), excluded: messagesOf(excluded) }).toEqual({
        included: [],
        excluded: ["Unknown property 'r' on 'g.records.results'."],
      });
    });

    it('should honour a directive on a fragment spread', async () => {
      const offenses = await runBare(`{% graphql g, flag: false %}
query q($flag: Boolean = false) {
  records { results { id ...rec @include(if: $flag) } }
}
fragment rec on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'name' on 'g.records.results'."]);
    });

    it('should verify nothing under an unresolved conditional field, and all of a proven one', async () => {
      const conditional = `query q($flag: Boolean) {
  records { results { r: related_record @include(if: $flag) { name } } }
}`;
      const unresolved = await runBare(`{% graphql g %}
${conditional}
{% endgraphql %}
{{ g.records.results.r.bogus }}`);
      const proven = await runBare(`{% graphql g, flag: true %}
${conditional}
{% endgraphql %}
{{ g.records.results.r.bogus }}`);

      expect({ unresolved: messagesOf(unresolved), proven: messagesOf(proven) }).toEqual({
        unresolved: [],
        proven: ["Unknown property 'bogus' on 'g.records.results.r'."],
      });
    });

    it('should drop the conditional marker for a field another selection has unconditionally', async () => {
      const offenses = await runBare(`{% graphql g %}
query q($flag: Boolean) {
  records {
    results {
      r: related_record { name }
      r: related_record @include(if: $flag) { name }
    }
  }
}
{% endgraphql %}
{{ g.records.results.r.bogus }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'g.records.results.r'."]);
    });
  });

  describe('{% graphql %} — with the platformOS schema', () => {
    it('should know results is a list, so first reaches an item', async () => {
      const offenses = await run(`{% graphql g %}
query { records { results { id } } }
{% endgraphql %}
{{ g.records.results.first.id }}
{{ g.records.results.size }}
{{ g.records.results.first.bogus }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'bogus' on 'g.records.results.first'.",
      ]);
    });

    it('should not treat a custom scalar as a primitive', async () => {
      // `Record.properties` is a `HashObject`: a scalar in the schema, a hash at runtime.
      const offenses = await run(`{% graphql g %}
query { records { results { properties name } } }
{% endgraphql %}
{{ g.records.results.first.properties.color }}
{{ g.records.results.first.name.size }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  /** Every arity and key rule below was measured against a live instance. */
  describe('navigation filters', () => {
    const NESTED = `{% assign data = '{"a": {"b": {"c": 1}}}' | parse_json %}`;
    const SHALLOW = `{% assign data = '{"a": {"b": 1}}' | parse_json %}`;
    const IMAGES = `{% assign data = '{"images": [{"url": "u"}]}' | parse_json %}`;

    it('should walk EVERY key a dig names, however the chain is spelled', async () => {
      // Walking only the first key would land on `{ b: … }`, where `c` is absent and `zzz`
      // is too — so the single reported key is what tells the two paths apart.
      const reads = `{{ val.c }}\n{{ val.zzz }}`;
      const multiKey = await run(`${NESTED}
{% assign val = data | dig: "a", "b" %}
${reads}`);
      const chained = await run(`${NESTED}
{% assign val = data | dig: "a" | dig: "b" %}
${reads}`);
      const hashDig = await run(`${NESTED}
{% assign val = data | hash_dig: "a", "b" %}
${reads}`);

      const reported = ["Unknown property 'zzz' on 'val'."];
      expect({
        multiKey: messagesOf(multiKey),
        chained: messagesOf(chained),
        hashDig: messagesOf(hashDig),
      }).toEqual({ multiKey: reported, chained: reported, hashDig: reported });
    });

    it('should follow the one key of a fetch, in either spelling', async () => {
      const reads = `{{ val.b }}\n{{ val.zzz }}`;
      const fetch = await run(`${SHALLOW}
{% assign val = data | fetch: "a" %}
${reads}`);
      const hashFetch = await run(`${SHALLOW}
{% assign val = data | hash_fetch: "a" %}
${reads}`);

      const reported = ["Unknown property 'zzz' on 'val'."];
      expect({ fetch: messagesOf(fetch), hashFetch: messagesOf(hashFetch) }).toEqual({
        fetch: reported,
        hashFetch: reported,
      });
    });

    it('should claim nothing for a fetch given two keys, which raises rather than digging', async () => {
      const offenses = await run(`${SHALLOW}
{% assign val = data | fetch: "a", "b" %}
{{ val.zzz }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should claim nothing without a static key, or once a filter transforms', async () => {
      const variableKey = await run(`${SHALLOW}
{% assign val = data | dig: some_key %}
{{ val.zzz }}`);
      const namedArgument = await run(`${SHALLOW}
{% assign val = data | dig: key: "a" %}
{{ val.zzz }}`);
      const noKey = await run(`${SHALLOW}
{% assign val = data | dig %}
{{ val.zzz }}`);
      const transforming = await run(`${SHALLOW}
{% assign val = data | dig: "a" | hash_merge: extra %}
{{ val.zzz }}`);
      const unknownSource = await run(`{% assign val = dynamic_var | dig: "key" %}
{{ val.anything }}`);

      expect({
        variableKey: messagesOf(variableKey),
        namedArgument: messagesOf(namedArgument),
        noKey: messagesOf(noKey),
        transforming: messagesOf(transforming),
        unknownSource: messagesOf(unknownSource),
      }).toEqual({
        variableKey: [],
        namedArgument: [],
        noKey: [],
        transforming: [],
        unknownSource: [],
      });
    });

    it('should require a hash per FILTER, not per chain', async () => {
      // A list piped in raises and the page stops. The second case is the same raise
      // mid-chain, which a flattened path would miss; the third is the navigable form.
      const listPiped = await run(`{% assign list = '[{"url": "u"}]' | parse_json %}
{% assign val = list | dig: 0, "url" %}
{{ val.zzz }}`);
      const listMidChain = await run(`${IMAGES}
{% assign val = data | dig: "images" | dig: 0 %}
{{ val.zzz }}`);
      // The control, and the numeric key on the way through: ONE `dig` given both keys
      // indexes the array without ever piping a list into a filter.
      const oneDigBothKeys = await run(`${IMAGES}
{% assign val = data | dig: "images", 0 %}
{{ val.url }}
{{ val.zzz }}`);

      expect({
        listPiped: messagesOf(listPiped),
        listMidChain: messagesOf(listMidChain),
        oneDigBothKeys: messagesOf(oneDigBothKeys),
      }).toEqual({
        listPiped: [],
        listMidChain: [],
        oneDigBothKeys: ["Unknown property 'zzz' on 'val'."],
      });
    });

    it('CONTROL: should report the same reads without the filter in the way', async () => {
      const digged = await run(`${SHALLOW}
{{ data.zzz }}`);
      const listed = await run(`{% assign list = '[{"url": "u"}]' | parse_json %}
{{ list.first.zzz }}`);

      expect({ digged: messagesOf(digged), listed: messagesOf(listed) }).toEqual({
        digged: ["Unknown property 'zzz' on 'data'."],
        listed: ["Unknown property 'zzz' on 'list.first'."],
      });
    });

    it('should keep an array an array, so size and first still navigate it', async () => {
      const offenses = await run(`{% assign data = '{"results": [{"id": 1}]}' | parse_json %}
{% assign items = data | dig: "results" %}
{{ items.size }}
{{ items.first.id }}
{{ items.first.zzz }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'zzz' on 'items.first'."]);
    });

    it('should navigate a {% graphql %} result the tag itself filtered', async () => {
      // htevent writes `graphql venue_rooms = 'venue_rooms/show' | fetch: "records"` and
      // then reads `venue_rooms.results`, which must be verified against the FETCHED value.
      const fetched = await run(
        `{% graphql g = 'q' | fetch: "records" %}
{{ g.results.first.id }}
{{ g.zzz }}`,
        RECORDS_QUERY_APP,
      );
      const digged = await run(
        `{% graphql g = 'q' | dig: "records", "results" %}
{{ g.first.id }}
{{ g.first.zzz }}`,
        RECORDS_QUERY_APP,
      );
      const unfiltered = await run(
        `{% graphql g = 'q' %}
{{ g.records.results.first.id }}
{{ g.zzz }}`,
        RECORDS_QUERY_APP,
      );

      expect({
        fetched: messagesOf(fetched),
        digged: messagesOf(digged),
        unfiltered: messagesOf(unfiltered),
      }).toEqual({
        fetched: ["Unknown property 'zzz' on 'g'."],
        digged: ["Unknown property 'zzz' on 'g.first'."],
        unfiltered: ["Unknown property 'zzz' on 'g'."],
      });
    });

    it('should navigate an INLINE graphql result the tag filtered', async () => {
      const offenses = await runBare(`{% graphql result | dig: 'user' %}
query { user { id email } }
{% endgraphql %}
{{ result.id }}
{{ result.email }}
{{ result.missing }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'result'."]);
    });

    it('should claim nothing about a graphql result a NON-navigating filter rebuilt', async () => {
      // The value the tag assigns is what the filter returned, not what the query selected.
      // `{% assign %}` refuses the same case by name, and `{% function %}` any filter at all.
      const rebuilt = await run(
        `{% graphql g = 'q' | hash_merge: extra %}
{{ g.anything_hash_merge_added }}`,
        RECORDS_QUERY_APP,
      );
      const unfiltered = await run(
        `{% graphql g = 'q' %}
{{ g.anything_hash_merge_added }}`,
        RECORDS_QUERY_APP,
      );
      const assigned = await run(`{% assign h = '{"a": 1}' | parse_json | hash_merge: extra %}
{{ h.anything_hash_merge_added }}`);

      expect({
        rebuilt: messagesOf(rebuilt),
        unfiltered: messagesOf(unfiltered),
        assigned: messagesOf(assigned),
      }).toEqual({
        rebuilt: [],
        unfiltered: ["Unknown property 'anything_hash_merge_added' on 'g'."],
        assigned: [],
      });
    });

    it('should claim nothing when the shape comes from a `default:` the value may not need', async () => {
      // The fallback is parsed only when the expression is blank, so its shape describes the
      // value in one branch and the expression — which this analysis cannot read — in the
      // other. Taking the fallback as certain reported every key the real value carried.
      //
      // The keys it names are not FORGOTTEN, they are unverifiable: completion offers
      // `a` for this source (`ObjectAttributeCompletionProvider.spec.ts`), and neither the
      // key it names nor any other can be reported here. So `x.a` is as silent as `x.b`.
      const fallback = await run(`{% assign x = maybe_json | default: '{"a": 1}' | parse_json %}
{{ x.b }}
{{ x.a.deeper }}`);
      const literal = await run(`{% assign x = '{"a": 1}' | parse_json %}
{{ x.b }}`);

      expect({ fallback: messagesOf(fallback), literal: messagesOf(literal) }).toEqual({
        fallback: [],
        literal: ["Unknown property 'b' on 'x'."],
      });
    });

    /**
     * The same `default`, on the other side of the parse, where it means something else.
     *
     * `'[]' | parse_json` is an empty array, so Ruby's `default` fires on it and `x` holds the
     * unparsed TEXT of the fallback. Reading the chain as "the array, with a `default` that
     * changes nothing" reported `b` on a value that is not an array by the time it is read —
     * measured, and the reason `default` is not a filter this chain may carry.
     */
    it('should claim nothing when a `default:` follows the parse', async () => {
      const defaulted = await run(`{% assign x = '[]' | parse_json | default: '{"b": 2}' %}
{{ x.b }}`);
      // The control: the same chain without the `default` still reports, so the silence
      // above is the filter's doing and not the fixture's.
      const undefaulted = await run(`{% assign x = '[]' | parse_json %}
{{ x.b }}`);

      expect({
        defaulted: messagesOf(defaulted),
        undefaulted: messagesOf(undefaulted),
      }).toEqual({
        defaulted: [],
        undefaulted: ["Unknown property 'b' on 'x'."],
      });
    });
  });

  describe('writes through an lvalue path', () => {
    // `assign`, `hash_assign` and `function` all take an lvalue path, and `assign` also
    // has the `<<` push operator. A write to one key is not a claim about the whole
    // variable — neither a new one when nothing was known, nor a replacement of what was.

    it('should know the key it wrote onto a variable of unknown shape, and nothing else', async () => {
      // The write is the only evidence there is, and it proves "a hash with at least this
      // key" — enough for completion to offer `a`, and for a read THROUGH `a` to be
      // checked, while any other key stays unverifiable.
      const offenses = await run(`{% function x = 'p' %}
{% assign x["a"] = {"k": 1} %}
{{ x.a.k }}
{{ x.a.missing }}
{{ x.anything }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'x.a'."]);
    });

    it('should stay open through further writes onto a variable of unknown shape', async () => {
      // The keys we watched go in are not the whole picture when the value came from
      // somewhere we could not see, so closing on the second write would report every
      // other read of it as unknown. The control is the empty-literal test below, where a
      // write DOES close the shape and an absent key is reported.
      const twoWrites = await run(`{% assign object = null | hash_merge: items: items %}
{% hash_assign object['name'] = 'x' %}
{% hash_assign object['valid'] = true %}
{{ object.name }}
{{ object.items.ids }}`);
      // The same rule as a real page writes it: the read is an argument to the next call.
      const readAsArgument = await run(`{% liquid
  function relation = 'x', id: 1
  assign data = null | hash_merge: id: relation.id
  hash_assign relation['_incoming_changes'] = data
  function group_url = 'y', object: relation.r
%}`);

      expect({
        twoWrites: messagesOf(twoWrites),
        readAsArgument: messagesOf(readAsArgument),
      }).toEqual({ twoWrites: [], readAsArgument: [] });
    });

    it('should close an empty hash literal on the first write, and stay closed', async () => {
      // The other openness: `{}` describes nothing YET, and the writes that follow are
      // the whole of what it holds. This is the builder idiom.
      const offenses = await run(`{% assign filters = {} %}
{% hash_assign filters['page'] = 1 %}
{% hash_assign filters['tags'] = 'a,b' %}
{{ filters.page }}{{ filters.tags }}
{{ filters.tag }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'tag' on 'filters'."]);
    });

    it('should treat an empty hash NOBODY writes to as a placeholder', async () => {
      const offenses = await run(`{% assign object = {"valid": true, "errors": {}} %}
{{ object.errors.email }}
{{ object.valid }}
{{ object.bogus }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'object'."]);
    });

    it('should narrow rather than replace, whichever tag writes at the path', async () => {
      const assigned = await run(`{% assign x = {a: 1} %}
{% assign x["b"] = 2 %}
{{ x.a }}{{ x.b }}{{ x.c }}`);
      const hashAssigned = await run(`{% assign x = {a: 1} %}
{% hash_assign x["b"] = 2 %}
{{ x.a }}{{ x.b }}{{ x.c }}`);
      const functionAssigned = await run(`{% assign x = {a: 1} %}
{% function x["b"] = 'p' %}
{{ x.a }}{{ x.b }}{{ x.c }}`);

      const reported = ["Unknown property 'c' on 'x'."];
      expect({
        assigned: messagesOf(assigned),
        hashAssigned: messagesOf(hashAssigned),
        functionAssigned: messagesOf(functionAssigned),
      }).toEqual({ assigned: reported, hashAssigned: reported, functionAssigned: reported });
    });

    it('should keep the siblings when a write replaces one key of a known shape', async () => {
      const offenses = await run(`{% assign x = {"a": {}, "b": 1} %}
{% assign x["a"] = {"k": 1} %}
{{ x.a.k }}
{{ x.b }}
{{ x.c }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'c' on 'x'."]);
    });

    it('should not verify reads through a written value whose shape is unknown', async () => {
      const offenses = await run(`{% assign x = {a: 1} %}
{% hash_assign x["b"] = some_variable %}
{{ x.b.deeply.nested }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should follow a dig chain into the path it is written to', async () => {
      const offenses = await run(`{% assign d = {"u": {"n": 1}} %}
{% assign x = {} %}
{% assign x["a"] = d | dig: "u" %}
{{ x.a.n }}
{{ x.a.missing }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'x.a'."]);
    });

    it('should claim nothing when the lvalue path is dynamic', async () => {
      const offenses = await run(`{% assign x = {a: 1} %}
{% assign key = "b" %}
{% hash_assign x[key] = 2 %}
{{ x.a }}{{ x.b }}{{ x.zzz }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should not report the write target itself', async () => {
      const offenses = await run(`{% assign x = {a: 1} %}
{% hash_assign x["b"]["c"] = 2 %}
{% function x["d"] = 'p' %}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should take a literal at face value when it is pushed onto a list', async () => {
      // `{% assign x = 'text' %}` claims nothing — naming a string as one would turn every
      // `x.foo` into an offense, and Liquid answers nil there. A write THROUGH the name is
      // different: the claim is about the list's ITEMS.
      const pushed = await run(`{% assign list = [] %}
{% assign list << 'text' %}
{{ list.first.size }}
{{ list.first.upcase }}`);
      const plain = await run(`{% assign x = 'text' %}
{{ x.foo }}`);

      expect({ pushed: messagesOf(pushed), plain: messagesOf(plain) }).toEqual({
        pushed: ["Cannot access property 'upcase' on primitive value 'list.first'."],
        plain: [],
      });
    });

    it('should keep a list a list when assign pushes onto it', async () => {
      const offenses = await run(`{% assign list = [] %}
{% assign list << {a: 1} %}
{{ list.first.a }}
{{ list.size }}
{{ list.first.b }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'b' on 'list.first'."]);
    });

    it('should claim nothing when assign pushes onto a base that is not a list', async () => {
      const offenses = await run(`{% assign a = {"x": 1} %}
{% assign a << 2 %}
{{ a.x }}
{{ a.anything }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should keep an array an array when assign writes an element', async () => {
      const offenses = await run(`{% assign a = [{x: 1}] %}
{% assign a[0] = {y: 2} %}
{{ a.first.x }}{{ a.first.y }}
{{ a.first.z }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'z' on 'a.first'."]);
    });

    it('should propagate a known shape through a plain assign', async () => {
      const offenses = await run(`{% assign a = {"x": {"y": 1}} %}
{% assign b = a.x %}
{{ b.y }}
{{ b.z }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'z' on 'b'."]);
    });

    it('should reassign whatever a {% function %} returns, and verify before it', async () => {
      const after = await run(`{% assign object = { "valid": true, "id": id, "role": role } %}
{% function object = 'modules/core/commands/execute', object: object, mutation_name: 'x' %}
{% if object.errors == blank %}{{ object.valid }}{% endif %}`);
      const before = await run(`{% assign object = { "valid": true, "id": "123" } %}
{{ object.missing }}
{% function object = 'modules/core/commands/execute', object: object %}`);

      expect({ after: messagesOf(after), before: messagesOf(before) }).toEqual({
        after: [],
        before: ["Unknown property 'missing' on 'object'."],
      });
    });
  });

  /**
   * `size` is answered by every Liquid value: a string's length, an array's count, a
   * hash's number of keys. The hash was the one this check did not know about, so a
   * `.size` read on a shape it had PROVEN was reported as an unknown property.
   */
  describe('size', () => {
    it('should answer size on a hash, at any depth and however the hash was built', async () => {
      const literal =
        await run(`{% assign form = { "errors": { "email": "taken" }, "valid": false } %}
{{ form.size }}
{{ form.errors.size }}`);
      const parsed =
        await run(`{% parse_json form %}{"errors": {"email": "taken"}}{% endparse_json %}
{{ form.errors.size }}`);
      const selected = await runBare(`{% graphql r %}{ users { id name } }{% endgraphql %}
{{ r.users.size }}`);

      expect({
        literal: messagesOf(literal),
        parsed: messagesOf(parsed),
        selected: messagesOf(selected),
      }).toEqual({ literal: [], parsed: [], selected: [] });
    });

    it('should keep size a number on strings and arrays, and still report a real absence', async () => {
      const offenses = await run(`{% assign a = { "name": "text", "tags": ["x", "y"] } %}
{{ a.name.size }}
{{ a.tags.size }}
{{ a.tags.size.bogus }}
{{ a.count }}`);
      expect(messagesOf(offenses)).toEqual([
        "Cannot access property 'bogus' on primitive value 'a.tags.size'.",
        "Unknown property 'count' on 'a'.",
      ]);
    });

    it('should answer a hash key named size before the count', async () => {
      // Liquid looks the key up first, so `{ "size": {...} }` reads through to its value.
      const offenses = await run(`{% assign a = { "size": { "w": 1 } } %}
{{ a.size.w }}
{{ a.size.h }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'h' on 'a.size'."]);
    });
  });

  describe('a nil is ONE value, however it is spelled', () => {
    // Measured: `hash_assign h['k'] = null` leaves `k` in `hash_keys`, and `nil.anything`
    // renders nothing without raising.

    /**
     * `.size` does NOT tell a nil from a string, and this asserted for a while that it did.
     * Measured on a live instance:
     *
     *   {% assign x = {"a": null} %}
     *   {% if x.a.size == nil %}  -> YES        {% if x.a.size == 0 %}   -> NO
     *   {% if "abc".size == 3 %}  -> YES  (control: `.size` really is a number on a string)
     *
     * So `.size` through a nil is nil, not a number, and the read after it is nil too.
     * Reporting it was a false positive on the very construct the null guard exists for.
     *
     * The string case is more than that control: the null guard runs BEFORE the size
     * shortcut, and the two branches are otherwise indistinguishable by output — `.size` on a
     * nil and `.size` on a string both continue the walk. Swap them in `lookupPropertyPath`
     * and only this pair moves.
     */
    it('should apply the null guard before the size shortcut, however the nil is spelled', async () => {
      const written = await run(`{% assign x = {"a": nil} %}
{{ x.a.size.foo }}`);
      const writtenNull = await run(`{% assign x = {"a": null} %}
{{ x.a.size.foo }}`);
      const parsed = await run(`{% assign x = '{"a": null}' | parse_json %}
{{ x.a.size.foo }}`);
      const string = await run(`{% assign x = {"a": "text"} %}
{{ x.a.size.foo }}`);

      expect({
        written: messagesOf(written),
        writtenNull: messagesOf(writtenNull),
        parsed: messagesOf(parsed),
        string: messagesOf(string),
      }).toEqual({
        written: [],
        writtenNull: [],
        parsed: [],
        string: ["Cannot access property 'foo' on primitive value 'x.a.size'."],
      });
    });

    it('should verify a nil-valued key against a level that is still closed', async () => {
      const offenses = await run(`{% assign x = {"a": nil} %}
{{ x.a.deeply.nested }}
{{ x.zzz }}`);
      // The `zzz` control proves the silence about what is under `a` is not a shape the
      // check gave up on: the level itself is still verified.
      expect(messagesOf(offenses)).toEqual(["Unknown property 'zzz' on 'x'."]);
    });

    it('should claim nothing under a nil however the key got there, and still report a string', async () => {
      const written = await run(`{% assign h = {"a": 1} %}
{% hash_assign h['k'] = null %}
{{ h.k.anything }}`);
      const parsed = await run(`{% assign x = '{"a": null}' | parse_json %}
{{ x.a.b }}`);
      const stringLiteral = await run(`{% assign x = {"a": "text"} %}
{{ x.a.anything }}`);
      const stringWritten = await run(`{% assign x = {} %}
{% hash_assign x['s'] = 'text' %}
{{ x.s.b }}`);

      expect({
        written: messagesOf(written),
        parsed: messagesOf(parsed),
        stringLiteral: messagesOf(stringLiteral),
        stringWritten: messagesOf(stringWritten),
      }).toEqual({
        written: [],
        parsed: [],
        stringLiteral: ["Cannot access property 'anything' on primitive value 'x.a'."],
        stringWritten: ["Cannot access property 'b' on primitive value 'x.s'."],
      });
    });

    it('should claim nothing about an item when nil is one of the alternatives', async () => {
      // The item may BE the nil, and `nil.foo` is nil rather than an error — so the merge
      // must not decay to a bare primitive, which is what makes a read reportable.
      const withNil = await run(`{% assign list = [nil, "a"] %}
{{ list.first.foo }}`);
      const allPrimitive = await run(`{% assign list = ["b", "a"] %}
{{ list.first.foo }}`);

      expect({ withNil: messagesOf(withNil), allPrimitive: messagesOf(allPrimitive) }).toEqual({
        withNil: [],
        allPrimitive: ["Cannot access property 'foo' on primitive value 'list.first'."],
      });
    });
  });

  /**
   * Every case here is a SILENCE the check owes and does not pay, so every one is paired
   * with a control that must still fire. Without the control a suppression wide enough to
   * hide a real typo would pass all of them.
   */
  describe('merging ALTERNATIVES must let `unknown` absorb', () => {
    // Four sites alternate: return branches, `<<` pushes, array-literal elements and
    // array item writes. A key only one alternative names is `optional`.

    it('should claim nothing about an item once an element of unknown shape is pushed', async () => {
      const withMystery = await run(`{% liquid
  assign list = []
  assign list << {"a": 1}
  assign list << mystery
%}
{{ list[1].b }}`);
      const allKnown = await run(`{% liquid
  assign list = []
  assign list << {"a": 1}
%}
{{ list[1].b }}`);

      expect({ withMystery: messagesOf(withMystery), allKnown: messagesOf(allKnown) }).toEqual({
        withMystery: [],
        allKnown: ["Unknown property 'b' on 'list.1'."],
      });
    });

    it('should claim nothing about an item when a LITERAL element has unknown shape', async () => {
      // Both reads: the key no element names, and the key one element DOES. The known
      // element's keys survive for the editor — completion after `list.first.` offers `a`
      // (`ObjectAttributeCompletionProvider.spec.ts`) — and surviving must not mean they
      // become claims: `mystery` may hold anything, including a number with no `deeper`.
      const withMystery = await run(`{% assign list = [{"a": 1}, mystery] %}
{{ list.first.b }}
{{ list.first.a.deeper }}`);
      const allKnown = await run(`{% assign list = [{"a": 1}, {"a": 2}] %}
{{ list.first.b }}`);

      expect({ withMystery: messagesOf(withMystery), allKnown: messagesOf(allKnown) }).toEqual({
        withMystery: [],
        allKnown: ["Unknown property 'b' on 'list.first'."],
      });
    });

    it('should answer the same for a list a JSON STRING spells as for the literal', async () => {
      // A parsed array's elements are the same alternatives the literal's are.
      const parsed = await run(`{% assign x = '[{"a": {"c": 1}}, {"b": 2}]' | parse_json %}
{{ x[1].a.zzz }}`);
      const literal = await run(`{% assign x = [{"a": {"c": 1}}, {"b": 2}] %}
{{ x[1].a.zzz }}`);
      const noElementHasIt = await run(`{% assign x = '[{"a": 1}, {"a": 2}]' | parse_json %}
{{ x[1].zzz }}`);

      expect({
        parsed: messagesOf(parsed),
        literal: messagesOf(literal),
        noElementHasIt: messagesOf(noElementHasIt),
      }).toEqual({
        parsed: [],
        literal: [],
        noElementHasIt: ["Unknown property 'zzz' on 'x.1'."],
      });
    });

    it('should claim nothing about an item once an element is WRITTEN', async () => {
      // The written element and the elements already there are alternatives too: one
      // element nobody can see into leaves no claim about "an item", and a key written
      // into ONE element is not a fact about the rest.
      const writtenMystery = await run(`{% liquid
  assign a = [{"x": 1}]
  assign a[0] = mystery
%}
{{ a.first.zzz }}`);
      const writtenKey = await run(`{% liquid
  assign a = [{"x": 1}]
  assign a[0]["y"] = {"n": 1}
%}
{{ a.first.y.zzz }}`);
      const unwritten = await run(`{% assign a = [{"x": 1}] %}
{{ a.first.zzz }}`);

      expect({
        writtenMystery: messagesOf(writtenMystery),
        writtenKey: messagesOf(writtenKey),
        unwritten: messagesOf(unwritten),
      }).toEqual({
        writtenMystery: [],
        writtenKey: [],
        unwritten: ["Unknown property 'zzz' on 'a.first'."],
      });
    });

    it('should claim nothing about a nested item when one alternative LIST is opaque', async () => {
      // Two arrays merged as alternatives: items nobody can name on either side means
      // items nobody can name. Keeping the side that HAS an item shape would describe
      // every element of the merge by the one list we happened to see into.
      const oneEmpty = await run(`{% assign x = [[{"a": 1}], []] %}
{{ x.first.first.zzz }}`);
      const bothKnown = await run(`{% assign x = [[{"a": 1}], [{"a": 2}]] %}
{{ x.first.first.zzz }}`);

      expect({ oneEmpty: messagesOf(oneEmpty), bothKnown: messagesOf(bothKnown) }).toEqual({
        oneEmpty: [],
        bothKnown: ["Unknown property 'zzz' on 'x.first.first'."],
      });
    });

    it('should claim nothing about a returned key one branch cannot see into', async () => {
      const files: MockApp = {
        'app/lib/branches.liquid': `{% liquid
  if flag
    assign out = {"a": {"b": 1}}
    return out
  else
    assign out = {"a": mystery}
    return out
  endif
%}`,
        'app/lib/branches_agree.liquid': `{% liquid
  if flag
    assign out = {"a": {"b": 1}}
    return out
  else
    assign out = {"a": {"b": 2}}
    return out
  endif
%}`,
      };
      const opaqueBranch = await run(
        `{% function r = 'branches' %}
{{ r.a.c }}`,
        files,
      );
      const branchesAgree = await run(
        `{% function r = 'branches_agree' %}
{{ r.a.c }}`,
        files,
      );

      expect({
        opaqueBranch: messagesOf(opaqueBranch),
        branchesAgree: messagesOf(branchesAgree),
      }).toEqual({
        opaqueBranch: [],
        branchesAgree: ["Unknown property 'c' on 'r.a'."],
      });
    });

    it('should claim nothing THROUGH a key only one branch returns', async () => {
      // A key one alternative does not have is `optional`, and nothing under an optional
      // key is verifiable: in the other branch there is no `a` for `a.zzz` to be wrong of.
      // A key NO branch returns is still reportable, which is the control.
      const files: MockApp = {
        'app/lib/disjoint.liquid': `{% liquid
  if flag
    return {"a": {"b": 1}}
  else
    return {"c": 2}
  endif
%}`,
      };
      const throughOptional = await run(
        `{% function r = 'disjoint' %}
{{ r.a.zzz }}`,
        files,
      );
      const absentEverywhere = await run(
        `{% function r = 'disjoint' %}
{{ r.zzz }}`,
        files,
      );

      expect({
        throughOptional: messagesOf(throughOptional),
        absentEverywhere: messagesOf(absentEverywhere),
      }).toEqual({
        throughOptional: [],
        absentEverywhere: ["Unknown property 'zzz' on 'r'."],
      });
    });
  });

  describe('loop variables', () => {
    /** A query result, a `group_by` this check cannot see into, and a loop that shadows. */
    const app: MockApp = {
      'app/graphql/audience.graphql': `query audience {
  tags(per_page: 10) {
    results {
      id
      relationships { name l_id }
    }
  }
}`,
    };

    // `tags` is not a root field `RECORDS_SDL` declares, so these run without it.
    const runLoop = (body: string) => runBare(`{% liquid\n${body}\n%}`, app);

    it('should claim nothing about a loop variable, whether or not it shadows a shape', async () => {
      const shadowing = await runLoop(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for r in grouped['followship:tag']
    assign x = r.l_id
  endfor`);
      const ownName = await runLoop(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for rel in grouped['followship:tag']
    assign x = rel.l_id
  endfor`);
      const offTheResultItself = await runLoop(`  graphql r = 'audience'
  assign x = r.l_id`);

      expect({
        shadowing: messagesOf(shadowing),
        ownName: messagesOf(ownName),
        offTheResultItself: messagesOf(offTheResultItself),
      }).toEqual({
        shadowing: [],
        ownName: [],
        offTheResultItself: ["Unknown property 'l_id' on 'r'."],
      });
    });

    it('should restore the shadowed variable after the loop ends', async () => {
      const offenses = await runLoop(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  for r in grouped['followship:tag']
    assign x = r.l_id
  endfor
  assign y = r.tags.results
  assign z = r.bogus`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'r'."]);
    });

    it('should report a genuinely absent property on an item whose shape is known', async () => {
      const offenses = await runLoop(`  assign rows = [{ "id": 1 }, { "id": 2 }]
  for row in rows
    assign a = row.id
    assign b = row.bogus
  endfor`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'row'."]);
    });

    it('should claim nothing when the loop has no item shape to bind', async () => {
      const overAHash = await runLoop(`  assign hash = { "a": 1 }
  for pair in hash
    assign x = pair.anything
  endfor`);
      const emptyList = await runLoop(`  assign rows = []
  for row in rows
    assign x = row.anything
  endfor`);
      const unreadableMarkup = await runLoop(`  assign rows = [{ "id": 1 }]
  for row in
    assign x = row.anything
  endfor
  assign y = rows.first.anything`);

      expect({
        overAHash: messagesOf(overAHash),
        emptyList: messagesOf(emptyList),
        unreadableMarkup: messagesOf(unreadableMarkup),
      }).toEqual({ overAHash: [], emptyList: [], unreadableMarkup: [] });
    });

    it('should bind a tablerow variable exactly as for does', async () => {
      const shadowing = await runLoop(`  graphql r = 'audience'
  assign grouped = r.tags.results | group_by: 'name'
  tablerow r in grouped['followship:tag']
    assign x = r.l_id
  endtablerow
  assign y = r.tags.results`);
      const knownItem = await runLoop(`  assign rows = [{ "id": 1 }]
  tablerow row in rows
    assign a = row.bogus
  endtablerow`);

      expect({ shadowing: messagesOf(shadowing), knownItem: messagesOf(knownItem) }).toEqual({
        shadowing: [],
        knownItem: ["Unknown property 'bogus' on 'row'."],
      });
    });

    it('should keep a partial that mutates through a loop item from claiming a closed shape', async () => {
      // A loop item is a REFERENCE into the collection, so a partial that writes through
      // one returns a shape that may carry fields nobody saw assigned.
      const offenses = await run(
        `{% function rows = 'queries/rows' %}
{{ rows.first.id }}
{{ rows.first.total }}`,
        {
          'app/lib/queries/rows.liquid': `{% liquid
  assign rows = [{ "id": 1 }]
  for row in rows
    hash_assign row['total'] = 1
  endfor
  return rows
%}`,
        },
      );
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('{% function %} return shapes', () => {
    /**
     * A page calls a query partial that forwards an argument into an `@include`. Whether
     * `relation.r` exists is a property of the CALL, not of the query.
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

    const app: MockApp = {
      'app/graphql/relationships/search.graphql': SEARCH_GRAPHQL,

      'app/lib/queries/relationships/find_by_id.liquid': `{% liquid
  if id == blank
    log 'ID cannot be blank', type: 'ERROR'
    return null
  endif

  graphql r = 'relationships/search', limit: 1, id: id, include_related: include_related
  return r.records.results.first
%}`,

      /** Accepts `include_related` and forgets to forward it. */
      'app/lib/queries/relationships/find_by_id_unforwarded.liquid': `{% liquid
  graphql r = 'relationships/search', limit: 1, id: id
  return r.records.results.first
%}`,

      /** One more hop: a partial whose whole job is to call the query partial. */
      'app/lib/queries/relationships/find_for_profile.liquid': `{% liquid
  function relation = 'queries/relationships/find_by_id', id: id, include_related: include_related
  return relation
%}`,
    };

    const runPage = (
      body: string,
      files: MockApp = app,
      dependencies: Partial<Dependencies> = withSchema,
    ) => run(`{% liquid\n  ${body}\n%}`, files, dependencies);

    const FIND = `function relation = 'queries/relationships/find_by_id', id: 1`;

    it('should resolve the query shape through the partial when the argument is true', async () => {
      const offenses = await runPage(`${FIND}, include_related: true
  assign a = relation.id
  assign b = relation.name
  assign c = relation.r.slug
  assign d = relation.bogus`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'relation'."]);
    });

    it('should report the conditional field unless the call proves it is included', async () => {
      const passedFalse = await runPage(`${FIND}, include_related: false
  assign a = relation.r`);
      const omitted = await runPage(`${FIND}
  assign a = relation.r`);
      const neverForwarded =
        await runPage(`function relation = 'queries/relationships/find_by_id_unforwarded', id: 1, include_related: true
  assign a = relation.r`);
      const neverSelected = await runPage(
        `${FIND}, include_related: true
  assign a = relation.r`,
        {
          ...app,
          'app/graphql/relationships/search.graphql': NO_RELATED_GRAPHQL,
        },
      );

      const reported = ["Unknown property 'r' on 'relation'."];
      expect({
        passedFalse: messagesOf(passedFalse),
        omitted: messagesOf(omitted),
        neverForwarded: messagesOf(neverForwarded),
        neverSelected: messagesOf(neverSelected),
      }).toEqual({
        passedFalse: reported,
        omitted: reported,
        neverForwarded: reported,
        neverSelected: reported,
      });
    });

    it('should forward only a boolean the page can prove', async () => {
      const included = await runPage(`assign flag = true
  ${FIND}, include_related: flag
  assign a = relation.r.slug`);
      const excluded = await runPage(`assign flag = false
  ${FIND}, include_related: flag
  assign a = relation.r`);
      const unprovable = await runPage(`${FIND}, include_related: context.params.related
  assign a = relation.r.slug`);

      expect({
        included: messagesOf(included),
        excluded: messagesOf(excluded),
        unprovable: messagesOf(unprovable),
      }).toEqual({
        included: [],
        excluded: ["Unknown property 'r' on 'relation'."],
        unprovable: [],
      });
    });

    it('should keep the object shape when another branch returns null', async () => {
      // `find_by_id` returns `null` before it returns the record, and the null branch
      // must not erase what the other branch proves.
      const offenses = await runPage(
        `${FIND}, include_related: true
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
      const offenses = await runPage(`${FIND}, include_related: true
  assign n = relation.size
  assign m = relation.count`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'count' on 'relation'."]);
    });

    it('should claim nothing when the partial gives it nothing to go on', async () => {
      const missing = await runPage(`function relation = 'queries/nope', id: 1
  assign a = relation.anything`);
      const unparseable = await runPage(
        `function relation = 'queries/broken', id: 1
  assign a = relation.anything`,
        { ...app, 'app/lib/queries/broken.liquid': '{% if %}{% endunless %}' },
      );
      const recursive = await runPage(
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
      const opaque = await runPage(
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
      const inconsistentKinds = await runPage(
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
      const filtered = await runPage(`${FIND}, include_related: true | to_hash
  assign a = relation.bogus`);

      expect({
        missing: messagesOf(missing),
        unparseable: messagesOf(unparseable),
        recursive: messagesOf(recursive),
        opaque: messagesOf(opaque),
        inconsistentKinds: messagesOf(inconsistentKinds),
        filtered: messagesOf(filtered),
      }).toEqual({
        missing: [],
        unparseable: [],
        recursive: [],
        opaque: [],
        inconsistentKinds: [],
        filtered: [],
      });
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
      // `recalculate/build`, reduced: the partial writes onto the ITEMS of the collection
      // it was handed, through a `for` alias. Liquid hands out references, so those keys
      // are there at runtime — and nothing in this model saw them assigned.
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

    it('should claim nothing when no schema says results is a list', async () => {
      // Without the SDL nothing says `results` is a list, so the shape is unknown all the
      // way up. The SAME partial URI as the schema-ful tests above, deliberately: the memo
      // key carries the schema, so the answer computed with one is never served to a run
      // without it. This used to need a second URI for identical source.
      const offenses = await runPage(
        `function relation = 'queries/relationships/find_by_id', id: 1, include_related: true
  assign a = relation.bogus`,
        app,
        {},
      );
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should re-answer when a file the analysis read has changed', async () => {
      // The memo key is `(partial uri, bindings)` and deliberately NOT the text of what it
      // read, so `isStale` re-reading those files is what makes an edit visible. Each pair
      // asks the same question twice, so the second run hits the entry the first left.
      const CALLER = `{% function r = 'queries/memo' %}
{{ r.a }}
{{ r.zzz }}`;
      const partialBefore = await run(CALLER, {
        'app/lib/queries/memo.liquid': `{% liquid
  assign out = {"a": 1}
  return out
%}`,
      });
      const partialAfter = await run(CALLER, {
        'app/lib/queries/memo.liquid': `{% liquid
  assign out = {"zzz": 1}
  return out
%}`,
      });

      const QUERY_CALLER = `${FIND}, include_related: true
  assign a = relation.r`;
      const queryBefore = await runPage(QUERY_CALLER);
      const queryAfter = await runPage(QUERY_CALLER, {
        ...app,
        'app/graphql/relationships/search.graphql': NO_RELATED_GRAPHQL,
      });

      expect({
        partialBefore: messagesOf(partialBefore),
        partialAfter: messagesOf(partialAfter),
        queryBefore: messagesOf(queryBefore),
        queryAfter: messagesOf(queryAfter),
      }).toEqual({
        partialBefore: ["Unknown property 'zzz' on 'r'."],
        partialAfter: ["Unknown property 'a' on 'r'."],
        queryBefore: [],
        queryAfter: ["Unknown property 'r' on 'relation'."],
      });
    });
  });

  /**
   * page → command partial → query partial → `.graphql` → an SDL-typed selection →
   * `.first`. Every expectation below was checked against `pos-module-community` running
   * on a live instance, with the platform's tables renamed to the ones `RECORDS_SDL` knows.
   */
  describe('a real platformOS chain, runtime-verified', () => {
    const app: MockApp = {
      'app/graphql/records/load.graphql': `query load($id: ID, $with_extra: Boolean = false) {
  records(per_page: 1, filter: { id: { value: $id } }) {
    results {
      id
      created_at
      name: property(name: "name")
      roles: property_array(name: "roles")
      extra: property(name: "extra") @include(if: $with_extra)
    }
  }
}`,

      /** The query partial: run the document, take the first result, hand it back. */
      'app/lib/queries/records/load.liquid': `{% liquid
  graphql g = 'records/load', id: id, with_extra: with_extra
  assign record = g.records.results.first
  return record
%}`,

      /** The command partial: one more hop, and two keys the query never selected. */
      'app/lib/commands/records/build.liquid': `{% liquid
  function record = 'queries/records/load', id: id
  hash_assign record['email'] = 'someone@example.com'
  hash_assign record['permissions'] = null
  return record
%}`,

      /** What `profiles/find` really does, and why the check says nothing about it. */
      'app/lib/commands/records/merged.liquid': `{% liquid
  function record = 'queries/records/load', id: id
  assign record = record | hash_merge: extra_keys
  return record
%}`,

      /** The navigation filter mid-chain. */
      'app/lib/queries/records/fetched.liquid': `{% liquid
  graphql g = 'records/load', id: id | fetch: 'records'
  return g.results.first
%}`,
    };

    const runPage = (body: string) => run(body, app);

    it('should verify every field the query selects and report the ones it does not', async () => {
      const offenses = await runPage(`{% function record = 'queries/records/load', id: '1' %}
{{ record.id }}
{{ record.created_at }}
{{ record.name }}
{{ record.roles.first }}
{{ record.roles.size }}
{{ record.permissions }}
{{ record.hook_results }}
{{ record.roles.bogus }}`);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'permissions' on 'record'.",
        "Unknown property 'hook_results' on 'record'.",
        "Unknown property 'bogus' on 'record.roles'.",
      ]);
    });

    it('should decide a conditional field from the argument the page forwards', async () => {
      // The live chain's `token: temporary_token @include(if: $with_token)` with
      // `$with_token: Boolean = false` really is absent from the result.
      const defaulted = await runPage(`{% function record = 'queries/records/load', id: '1' %}
{{ record.extra }}`);
      const forwarded =
        await runPage(`{% function record = 'queries/records/load', id: '1', with_extra: true %}
{{ record.extra }}`);

      expect({ defaulted: messagesOf(defaulted), forwarded: messagesOf(forwarded) }).toEqual({
        defaulted: ["Unknown property 'extra' on 'record'."],
        forwarded: [],
      });
    });

    it('should carry the written keys and the queried ones through two call boundaries', async () => {
      // `hash_assign record['permissions'] = null` leaves the KEY there — measured — so a
      // read of it is legal however useless, and a read THROUGH it is unverifiable.
      const offenses = await runPage(`{% function record = 'commands/records/build', id: '1' %}
{{ record.id }}
{{ record.name }}
{{ record.email }}
{{ record.permissions }}
{{ record.permissions.anything }}
{{ record.nope }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'nope' on 'record'."]);
    });

    it('should claim nothing once a partial merges in keys from outside', async () => {
      const merged = await runPage(`{% function record = 'commands/records/merged', id: '1' %}
{{ record.anything_at_all }}`);
      const unmerged = await runPage(`{% function record = 'commands/records/build', id: '1' %}
{{ record.anything_at_all }}`);

      expect({ merged: messagesOf(merged), unmerged: messagesOf(unmerged) }).toEqual({
        merged: [],
        unmerged: ["Unknown property 'anything_at_all' on 'record'."],
      });
    });

    it('should follow a fetch on the graphql result and verify what is under it', async () => {
      const offenses = await runPage(`{% function record = 'queries/records/fetched', id: '1' %}
{{ record.id }}
{{ record.name }}
{{ record.bogus }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'record'."]);
    });

    it('should accept the errors guard on a file-based query without claiming under it', async () => {
      const offenses = await runPage(`{% graphql g = 'records/load', id: '1' %}
{% if g.errors %}{{ g.errors.first.message }}{{ g.errors.first.whatever }}{% endif %}
{{ g.records.results.first.id }}
{{ g.bogus }}`);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'g'."]);
    });
  });

  describe('shapes the check must not claim', () => {
    it('should not let a write inside one branch describe a sibling branch', async () => {
      const branched = await run(`{% assign orders = {"results": [{"id": 1}]} %}
{% if a %}
  {% assign orders = orders.results %}
{% elsif b %}
  {% assign first = orders.results.first %}
{% endif %}
{% assign after = orders.results %}`);
      const straightLine = await run(`{% assign orders = {"results": [{"id": 1}]} %}
{% assign orders = orders.results %}
{% assign again = orders.results %}`);

      expect({ branched: messagesOf(branched), straightLine: messagesOf(straightLine) }).toEqual({
        branched: [],
        straightLine: ["Unknown property 'results' on 'orders'."],
      });
    });

    it('should stop claiming a shape a conditional branch may have replaced', async () => {
      const afterTheBranch = await run(`{% assign a = {"x": 1} %}
{% if c %}{% assign a = {"y": 2} %}{% endif %}
{{ a.x }}{{ a.zzz }}`);
      const insideTheBranch = await run(
        `{% if c %}{% assign a = {"y": 2} %}{{ a.y }}{{ a.zzz }}{% endif %}`,
      );

      expect({
        afterTheBranch: messagesOf(afterTheBranch),
        insideTheBranch: messagesOf(insideTheBranch),
      }).toEqual({
        afterTheBranch: [],
        insideTheBranch: ["Unknown property 'zzz' on 'a'."],
      });
    });

    it('should forget a shape a capture replaced', async () => {
      const offenses = await run(`{% assign a = {"x": 1} %}
{% capture a %}text{% endcapture %}
{{ a.x }}
{{ a.anything }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should forget every shape when a tag that assigns has markup it cannot read', async () => {
      const offenses = await run(`{% assign object = {"x": 1} %}
{% function object = 'p', current_profile %}
{{ object.x }}
{{ object.anything }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should claim nothing when a filter after parse_json changes the value', async () => {
      const offenses =
        await run(`{% assign site = '{"type": "site"}' | parse_json | hash_merge: settings: settings %}
{{ site.type }}
{{ site.settings }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('a counter tag assigns nothing this analyzer tracks', () => {
    // Measured, because the obvious guess is the opposite: counters are a separate
    // namespace an assigned variable shadows, so a hash keeps its shape across one.

    it('should keep every shape across an increment, however it is spelled', async () => {
      const sameName = await run(`{% liquid
  assign a = {"x": 1}
  increment a
%}
{{ a.x }}
{{ a.zzz }}`);
      const unreadableMarkup = await run(`{% liquid
  assign a = {"x": 1}
  increment a.b
%}
{{ a.x }}
{{ a.zzz }}`);
      const anotherName = await run(`{% liquid
  assign a = {"x": 1}
  increment counter
%}
{{ a.zzz }}`);

      const reported = ["Unknown property 'zzz' on 'a'."];
      expect({
        sameName: messagesOf(sameName),
        unreadableMarkup: messagesOf(unreadableMarkup),
        anotherName: messagesOf(anotherName),
      }).toEqual({ sameName: reported, unreadableMarkup: reported, anotherName: reported });
    });

    it('CONTROL: should claim nothing about a name only a counter ever gave a value', async () => {
      // Nothing assigns `counter`, so it holds a number and this analyzer never had a
      // shape for it. Silence here is the absence of a claim, not a withdrawn one.
      const offenses = await run(`{% liquid
  increment counter
%}
{{ counter.zzz }}`);
      expect(messagesOf(offenses)).toEqual([]);
    });
  });
});
