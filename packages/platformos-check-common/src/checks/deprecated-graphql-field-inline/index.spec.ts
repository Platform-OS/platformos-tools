import { describe, expect, it } from 'vitest';

import { check } from '../../test';
import { dependenciesWithSchema } from '../../test/mock-docset';
import { Dependencies, Severity } from '../../types';
import { DeprecatedGraphQLField } from '../deprecated-graphql-field';
import { GraphQLInlineCheck } from '../graphql-inline';
import { DeprecatedGraphQLFieldInline } from './index';

/** The same schema `DeprecatedGraphQLField` is measured against, so the pair stays comparable. */
const SDL = `
type Query {
  records(filter: RecordFilter): RecordCollection
  models: RecordCollection @deprecated(reason: "Use records")
  byEnum(e: Flavour): String
  withArg(live: String, old: String @deprecated(reason: "use live")): String
}

type RecordCollection {
  results: [Record]
  total_entries: Int
  related_models: [Record] @deprecated(reason: "Use results")
}

type Record {
  id: ID
}

input RecordFilter {
  id: ID
  old_id: ID @deprecated(reason: "use id")
}

enum Flavour {
  LIVE
  OLD @deprecated(reason: "use LIVE")
}
`;

const withSchema = dependenciesWithSchema(SDL);

const withoutSchema: Partial<Dependencies> = {
  platformosDocset: { ...withSchema.platformosDocset!, graphQL: async () => null },
};

const PATH = 'app/views/pages/index.liquid';
const run = (source: string, deps = withSchema) =>
  check({ [PATH]: source }, [DeprecatedGraphQLFieldInline], deps);

describe('Module: DeprecatedGraphQLFieldInline', () => {
  it('reports a deprecated root field, carrying the schema reason verbatim', async () => {
    const offenses = await run('{% graphql r %}{ models { total_entries } }{% endgraphql %}');

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('The field Query.models is deprecated. Use records');
    expect(offenses[0].check).to.equal('DeprecatedGraphQLFieldInline');
    expect(offenses[0].uri).to.contain('index.liquid');
  });

  it('reports a deprecated field on a nested object, not only on the root', async () => {
    const offenses = await run(
      '{% graphql r %}{ records { related_models { id } } }{% endgraphql %}',
    );

    expect(offenses.map((o) => o.message)).to.eql([
      'The field RecordCollection.related_models is deprecated. Use results',
    ]);
  });

  it('reports a deprecated argument', async () => {
    const offenses = await run('{% graphql r %}{ withArg(old: "x") }{% endgraphql %}');

    expect(offenses.map((o) => o.message)).to.eql([
      'Field "Query.withArg" argument "old" is deprecated. use live',
    ]);
  });

  it('reports a deprecated enum value', async () => {
    const offenses = await run('{% graphql r %}{ byEnum(e: OLD) }{% endgraphql %}');

    expect(offenses.map((o) => o.message)).to.eql([
      'The enum value "Flavour.OLD" is deprecated. use LIVE',
    ]);
  });

  it('reports a deprecated input field', async () => {
    const offenses = await run(
      '{% graphql r %}{ records(filter: { old_id: "1" }) { total_entries } }{% endgraphql %}',
    );

    expect(offenses.map((o) => o.message)).to.eql([
      'The input field RecordFilter.old_id is deprecated. use id',
    ]);
  });

  it('reports nothing for an inline body using only current members', async () => {
    const offenses = await run(
      '{% graphql r %}{ records(filter: { id: "1" }) { total_entries } }{% endgraphql %}',
    );

    expect(offenses).to.be.empty;
  });

  it('ranges cover the deprecated name itself, not the whole selection', async () => {
    // The reason the name is preferred over the node: a Field's own range spans its alias and
    // every line of its sub-selection.
    const source = '<p>before</p>\n{% graphql r %}\n{ models { total_entries } }\n{% endgraphql %}\n';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('models');
  });

  it('points at the offending text on a CRLF file', async () => {
    const source =
      '<p>before</p>\r\n{% graphql r %}\r\n{ models { total_entries } }\r\n{% endgraphql %}\r\n';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('models');
  });

  it('points at the offending text when the body starts on the tag line', async () => {
    const source = '{% graphql r %}{ models { total_entries } }{% endgraphql %}';

    const offenses = await run(source);

    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('models');
  });

  it('reports each inline body in a file, at its own position', async () => {
    const source =
      '{% graphql a %}{ models { total_entries } }{% endgraphql %}\n' +
      '{% graphql b %}{ records { related_models { id } } }{% endgraphql %}';

    const offenses = await run(source);

    expect(offenses).to.have.length(2);
    expect(offenses.map((o) => source.slice(o.start.index, o.end.index)).sort()).to.eql([
      'models',
      'related_models',
    ]);
  });

  it('reports an inline body nested inside another tag', async () => {
    const source = '{% if true %}\n  {% graphql r %}{ models { id } }{% endgraphql %}\n{% endif %}';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('models');
  });

  it('leaves the file-based form to DeprecatedGraphQLField', async () => {
    const offenses = await run("{% graphql r = 'some/query' %}");

    expect(offenses).to.be.empty;
  });

  it('stays silent on a body that interpolates Liquid', async () => {
    const offenses = await run('{% graphql r %}{ {{ field }} }{% endgraphql %}');

    expect(offenses).to.be.empty;
  });

  it('stays silent when interpolation sits inside a string literal, so the raw body parses', async () => {
    // The guard that has to be all-text rather than parse-or-not: `{{ n }}` inside quotes
    // leaves a slice that IS valid GraphQL, so without it a query nobody wrote is validated.
    const offenses = await run(
      '{% graphql r %}{ records(filter: { old_id: "{{ n }}" }) { total_entries } }{% endgraphql %}',
    );

    expect(offenses).to.be.empty;
  });

  it('stays silent on a body that does not parse as GraphQL', async () => {
    const offenses = await run('{% graphql r %}{ models {% endgraphql %}');

    expect(offenses).to.be.empty;
  });

  it('stays silent, and does not throw, when the docset publishes no schema', async () => {
    const offenses = await run(
      '{% graphql r %}{ models { total_entries } }{% endgraphql %}',
      withoutSchema,
    );

    expect(offenses).to.be.empty;
  });

  it('still reports a deprecation in an inline body that is also schema-invalid', async () => {
    // A deprecation and an invalid field are independent findings; neither suppresses the other.
    const offenses = await run('{% graphql r %}{ nope models { total_entries } }{% endgraphql %}');

    expect(offenses.map((o) => o.message)).to.eql([
      'The field Query.models is deprecated. Use records',
    ]);
  });

  it('stays disjoint from GraphQLInlineCheck: each reports only its own class of finding', async () => {
    const offenses = await check(
      { [PATH]: '{% graphql r %}{ nope models { total_entries } }{% endgraphql %}' },
      [GraphQLInlineCheck, DeprecatedGraphQLFieldInline],
      withSchema,
    );

    const byCheck = new Map(offenses.map((o) => [o.check, o.message]));
    expect(byCheck.get('GraphQLInlineCheck')).to.equal(
      'Cannot query field "nope" on type "Query".',
    );
    expect(byCheck.get('DeprecatedGraphQLFieldInline')).to.equal(
      'The field Query.models is deprecated. Use records',
    );
    expect(offenses).to.have.length(2);
  });

  it('covers exactly what DeprecatedGraphQLField cannot, for the same body', async () => {
    // The pair's whole reason to exist: one body, one deprecation, reported once — by the
    // check whose source type can see the file it is written in.
    const body = '{% graphql r %}{ models { total_entries } }{% endgraphql %}';

    const offenses = await check(
      { [PATH]: body },
      [DeprecatedGraphQLField, DeprecatedGraphQLFieldInline],
      withSchema,
    );

    expect(offenses.map((o) => o.check)).to.eql(['DeprecatedGraphQLFieldInline']);
  });

  it('is a recommended WARNING, matching DeprecatedGraphQLField for the same finding', async () => {
    expect(DeprecatedGraphQLFieldInline.meta.severity).to.equal(Severity.WARNING);
    expect(DeprecatedGraphQLFieldInline.meta.severity).to.equal(
      DeprecatedGraphQLField.meta.severity,
    );
    expect(DeprecatedGraphQLFieldInline.meta.docs.recommended).to.be.true;
    expect(DeprecatedGraphQLFieldInline.meta.docs.url).to.be.a('string');
  });
});
