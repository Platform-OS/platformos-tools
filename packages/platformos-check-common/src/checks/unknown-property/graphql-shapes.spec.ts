import { describe, it, expect } from 'vitest';
import { RECORDS_SDL, dependenciesWithSchema, runLiquidCheck } from '../../test';
import { UnknownProperty } from './index';

const withSchema = dependenciesWithSchema(RECORDS_SDL);

const messagesOf = (offenses: { message: string }[]) => offenses.map((offense) => offense.message);

describe('Module: UnknownProperty — GraphQL shapes', () => {
  describe('fragment spreads', () => {
    it('should resolve the fields a spread contributes', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { id ...rec } } }
fragment rec on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}
{{ g.records.results.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve a spread nested inside another fragment', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { ...outer } } }
fragment outer on Record { id ...inner }
fragment inner on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}
{{ g.records.results.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve a spread inside a nested field selection', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { r: related_record { ...record } } } }
fragment record on Record { name avatar: related_record { url } }
{% endgraphql %}
{{ g.records.results.r.name }}
{{ g.records.results.r.avatar.url }}
{{ g.records.results.r.avatar.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'missing' on 'g.records.results.r.avatar'.",
      ]);
    });

    it('should report nothing for a spread whose fragment is not in the document', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { id ...defined_elsewhere } } }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should terminate on a cyclic fragment pair and report nothing', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { ...a } } }
fragment a on Record { id ...b }
fragment b on Record { name ...a }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should resolve the fields an inline fragment contributes', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { id ... on Record { name } } } }
{% endgraphql %}
{{ g.records.results.name }}
{{ g.records.results.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'missing' on 'g.records.results'."]);
    });

    it('should resolve one fragment spread into two aliases of the same field', async () => {
      // The shape of `modules/community/relationships/search`: `l` and `r` both spread
      // `record`, and `record` reaches a nested selection of its own.
      const sourceCode = `{% graphql g, include_related: true %}
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
{{ g.records.results.r.avatar.photo.missing }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'missing' on 'g.records.results.r.avatar.photo'.",
      ]);
    });
  });

  describe('@include / @skip', () => {
    const query = (directive: string) => `query q($flag: Boolean = false) {
  records { results { id r: related_record ${directive} { name } } }
}`;

    it('should treat a field as present when the call site passes true', async () => {
      const sourceCode = `{% graphql g, flag: true %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should report a field the call site excluded with false', async () => {
      const sourceCode = `{% graphql g, flag: false %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'g.records.results'."]);
    });

    it('should apply the declared default when the argument is not passed at all', async () => {
      const sourceCode = `{% graphql g %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'g.records.results'."]);
    });

    it('should report nothing when the argument is not passed and the query declares no default', async () => {
      const sourceCode = `{% graphql g %}
query q($flag: Boolean) {
  records { results { id r: related_record @include(if: $flag) { name } } }
}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should report nothing when the argument is forwarded from a variable of unknown value', async () => {
      const sourceCode = `{% assign flag = some_variable %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should forward a boolean the call site assigned to a variable', async () => {
      const sourceCode = `{% assign flag = true %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual([]);
    });

    it('should report a field excluded by a boolean the call site assigned to a variable', async () => {
      const sourceCode = `{% assign flag = false %}
{% graphql g, flag: flag %}
${query('@include(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'r' on 'g.records.results'."]);
    });

    it('should treat @skip as the inverse of @include', async () => {
      const skipped = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g, flag: true %}
${query('@skip(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`,
      );
      const kept = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g, flag: false %}
${query('@skip(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`,
      );
      const defaulted = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g %}
${query('@skip(if: $flag)')}
{% endgraphql %}
{{ g.records.results.r.name }}`,
      );

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
      const included = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g %}
${query('@include(if: true)')}
{% endgraphql %}
{{ g.records.results.r.name }}`,
      );
      const excluded = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g %}
${query('@include(if: false)')}
{% endgraphql %}
{{ g.records.results.r.name }}`,
      );

      expect({ included: messagesOf(included), excluded: messagesOf(excluded) }).toEqual({
        included: [],
        excluded: ["Unknown property 'r' on 'g.records.results'."],
      });
    });

    it('should honour a directive on a fragment spread', async () => {
      const sourceCode = `{% graphql g, flag: false %}
query q($flag: Boolean = false) {
  records { results { id ...rec @include(if: $flag) } }
}
fragment rec on Record { name }
{% endgraphql %}
{{ g.records.results.id }}
{{ g.records.results.name }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'name' on 'g.records.results'."]);
    });

    it('should verify nothing under an unresolved conditional field, and everything under a proven one', async () => {
      const unresolved = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g %}
query q($flag: Boolean) {
  records { results { r: related_record @include(if: $flag) { name } } }
}
{% endgraphql %}
{{ g.records.results.r.bogus }}`,
      );
      const proven = await runLiquidCheck(
        UnknownProperty,
        `{% graphql g, flag: true %}
query q($flag: Boolean) {
  records { results { r: related_record @include(if: $flag) { name } } }
}
{% endgraphql %}
{{ g.records.results.r.bogus }}`,
      );

      expect({ unresolved: messagesOf(unresolved), proven: messagesOf(proven) }).toEqual({
        unresolved: [],
        proven: ["Unknown property 'bogus' on 'g.records.results.r'."],
      });
    });

    it('should drop the conditional marker for a field another selection has unconditionally', async () => {
      const sourceCode = `{% graphql g %}
query q($flag: Boolean) {
  records {
    results {
      r: related_record { name }
      r: related_record @include(if: $flag) { name }
    }
  }
}
{% endgraphql %}
{{ g.records.results.r.bogus }}`;
      const offenses = await runLiquidCheck(UnknownProperty, sourceCode);
      expect(messagesOf(offenses)).toEqual(["Unknown property 'bogus' on 'g.records.results.r'."]);
    });
  });

  describe('with the platformOS schema', () => {
    it('should know results is a list, so first reaches an item', async () => {
      const sourceCode = `{% graphql g %}
query { records { results { id } } }
{% endgraphql %}
{{ g.records.results.first.id }}
{{ g.records.results.size }}
{{ g.records.results.first.bogus }}`;
      const offenses = await runLiquidCheck(
        UnknownProperty,
        sourceCode,
        'app/views/pages/index.liquid',
        withSchema,
      );
      expect(messagesOf(offenses)).toEqual([
        "Unknown property 'bogus' on 'g.records.results.first'.",
      ]);
    });

    it('should not treat a custom scalar as a primitive', async () => {
      // `Record.properties` is a `HashObject`: a scalar in the schema, a hash at runtime.
      const sourceCode = `{% graphql g %}
query { records { results { properties name } } }
{% endgraphql %}
{{ g.records.results.first.properties.color }}
{{ g.records.results.first.name.size }}`;
      const offenses = await runLiquidCheck(
        UnknownProperty,
        sourceCode,
        'app/views/pages/index.liquid',
        withSchema,
      );
      expect(messagesOf(offenses)).toEqual([]);
    });
  });
});
