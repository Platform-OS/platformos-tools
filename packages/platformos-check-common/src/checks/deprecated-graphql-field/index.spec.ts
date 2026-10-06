import { describe, expect, it } from 'vitest';

import { check } from '../../test';
import { dependenciesWithSchema } from '../../test/mock-docset';
import { Dependencies, Severity } from '../../types';
import { GraphQLCheck } from '../graphql';
import { DeprecatedGraphQLField } from './index';

/**
 * Every deprecation kind graphql-js's `NoDeprecatedCustomRule` reports, measured rather than
 * read off its documentation: a field, an argument, an enum value, an input field — and a
 * field on a NESTED object, which is where most hits in a real corpus land.
 */
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

/** A docset that publishes no schema — the condition `GraphQLCheck` also goes silent on. */
const withoutSchema: Partial<Dependencies> = {
  platformosDocset: { ...withSchema.platformosDocset!, graphQL: async () => null },
};

const run = (source: string, deps = withSchema, path = 'app/graphql/q.graphql') =>
  check({ [path]: source }, [DeprecatedGraphQLField], deps);

describe('Module: DeprecatedGraphQLField', () => {
  it('reports a deprecated root field, carrying the schema reason verbatim', async () => {
    const offenses = await run('{ models { total_entries } }');

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('The field Query.models is deprecated. Use records');
    expect(offenses[0].check).to.equal('DeprecatedGraphQLField');
  });

  it('reports a deprecated field on a nested object, not only on the root', async () => {
    const offenses = await run('{ records { related_models { id } } }');

    expect(offenses.map((o) => o.message)).to.eql([
      'The field RecordCollection.related_models is deprecated. Use results',
    ]);
  });

  it('reports a deprecated argument', async () => {
    const offenses = await run('{ withArg(old: "x") }');

    expect(offenses.map((o) => o.message)).to.eql([
      'Field "Query.withArg" argument "old" is deprecated. use live',
    ]);
  });

  it('reports a deprecated enum value', async () => {
    const offenses = await run('{ byEnum(e: OLD) }');

    expect(offenses.map((o) => o.message)).to.eql([
      'The enum value "Flavour.OLD" is deprecated. use LIVE',
    ]);
  });

  it('reports a deprecated input field', async () => {
    const offenses = await run('{ records(filter: { old_id: "1" }) { total_entries } }');

    expect(offenses.map((o) => o.message)).to.eql([
      'The input field RecordFilter.old_id is deprecated. use id',
    ]);
  });

  it('reports nothing for an operation using only current members', async () => {
    const offenses = await run(
      '{ records(filter: { id: "1" }) { results { id } total_entries } byEnum(e: LIVE) withArg(live: "x") }',
    );

    expect(offenses).to.be.empty;
  });

  it('ranges cover the deprecated name itself, not its line', async () => {
    const source = `{
  models { total_entries }
}`;

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('models');
  });

  it('reports every usage separately, each at its own position', async () => {
    const source = '{ a: models { total_entries } b: models { total_entries } }';

    const offenses = await run(source);

    expect(offenses).to.have.length(2);
    expect(offenses.map((o) => source.slice(o.start.index, o.end.index))).to.eql([
      'models',
      'models',
    ]);
    expect(offenses[0].start.index).to.not.equal(offenses[1].start.index);
  });

  it('offers no suggestion: a named successor is rarely a drop-in rename', async () => {
    const offenses = await run('{ models { total_entries } }');

    expect(offenses[0].suggest).to.be.undefined;
    expect(offenses[0].fix).to.be.undefined;
  });

  it('stays silent on a file that does not parse, which GraphQLCheck owns', async () => {
    const offenses = await run('{ models { unclosed ');

    expect(offenses).to.be.empty;
  });

  it('stays silent, and does not throw, when the docset publishes no schema', async () => {
    const offenses = await run('{ models { total_entries } }', withoutSchema);

    expect(offenses).to.be.empty;
  });

  it('still reports a deprecation in an operation that is also schema-invalid', async () => {
    // Measured: the rule tolerates an unresolvable field rather than abandoning the
    // document, so one mistake elsewhere does not hide every deprecation in the file.
    const offenses = await run('{ nope models { total_entries } }');

    expect(offenses.map((o) => o.message)).to.eql([
      'The field Query.models is deprecated. Use records',
    ]);
  });

  it('does not see an inline {% graphql %} body, which is GraphQL in a LiquidHtml file', async () => {
    // The scope boundary is deliberate and shared with every GraphQL-typed check:
    // SourceCodeType.GraphQL is reached only from the .graphql extension.
    const offenses = await check(
      {
        'app/views/pages/index.liquid':
          '{% graphql g %}{ models { total_entries } }{% endgraphql %}',
      },
      [DeprecatedGraphQLField],
      withSchema,
    );

    expect(offenses).to.be.empty;
  });

  it('stays disjoint from GraphQLCheck: each reports only its own class of finding', async () => {
    const offenses = await check(
      { 'app/graphql/q.graphql': '{ nope models { total_entries } }' },
      [GraphQLCheck, DeprecatedGraphQLField],
      withSchema,
    );

    const byCheck = new Map(offenses.map((o) => [o.check, o.message]));
    expect(byCheck.get('GraphQLCheck')).to.equal('Cannot query field "nope" on type "Query".');
    expect(byCheck.get('DeprecatedGraphQLField')).to.equal(
      'The field Query.models is deprecated. Use records',
    );
    expect(offenses).to.have.length(2);
  });

  it('is a recommended WARNING, like the other two deprecation checks', async () => {
    expect(DeprecatedGraphQLField.meta.severity).to.equal(Severity.WARNING);
    expect(DeprecatedGraphQLField.meta.docs.recommended).to.be.true;
    expect(DeprecatedGraphQLField.meta.docs.url).to.be.a('string');
  });
});
