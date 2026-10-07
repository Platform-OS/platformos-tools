import { describe, expect, it } from 'vitest';

import { check } from '../../test';
import { dependenciesWithSchema } from '../../test/mock-docset';
import { Dependencies, Severity } from '../../types';
import { GraphQLInlineCheck } from './index';

const SDL = `
type Query {
  records(id: ID, per_page: Int): RecordCollection
}

type RecordCollection {
  results: [Record]
  total_entries: Int
}

type Record {
  id: ID
}
`;

const withSchema = dependenciesWithSchema(SDL);

const withoutSchema: Partial<Dependencies> = {
  platformosDocset: { ...withSchema.platformosDocset!, graphQL: async () => null },
};

const PATH = 'app/views/pages/index.liquid';
const run = (source: string, deps = withSchema) =>
  check({ [PATH]: source }, [GraphQLInlineCheck], deps);

describe('Module: GraphQLInlineCheck', () => {
  it('reports a field absent from the schema', async () => {
    const offenses = await run('{% graphql r %}{ nope }{% endgraphql %}');

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('Cannot query field "nope" on type "Query".');
    expect(offenses[0].check).to.equal('GraphQLInlineCheck');
    expect(offenses[0].uri).to.contain('index.liquid');
  });

  it('reports a variable declared with the wrong type', async () => {
    // The shape measured across eight real applications: a `String!` variable passed where
    // the schema asks for `ID`.
    const offenses = await run(
      '{% graphql r %}\nquery q($id: String!) {\n  records(id: $id) { total_entries }\n}\n{% endgraphql %}',
    );

    expect(offenses.map((o) => o.message)).to.eql([
      'Variable "$id" of type "String!" used in position expecting type "ID".',
    ]);
  });

  it('reports nothing for a valid inline body', async () => {
    const offenses = await run(
      '{% graphql r %}\nquery q($id: ID) {\n  records(id: $id) { results { id } total_entries }\n}\n{% endgraphql %}',
    );

    expect(offenses).to.be.empty;
  });

  it('leaves the file-based form to GraphQLCheck', async () => {
    const offenses = await run("{% graphql r = 'some/query' %}");

    expect(offenses).to.be.empty;
  });

  it('stays silent on a body that interpolates Liquid', async () => {
    // Not all-text, so there is no document: the shape depends on a runtime value.
    const offenses = await run('{% graphql r %}{ {{ field }} }{% endgraphql %}');

    expect(offenses).to.be.empty;
  });

  it('stays silent when interpolation sits inside a string literal, so the raw body parses', async () => {
    // The case that makes the all-text guard load-bearing: `{{ n }}` inside quotes leaves a
    // slice that IS valid GraphQL, so without the guard this would be validated as written
    // and reported against a query nobody wrote.
    const offenses = await run('{% graphql r %}{ nope(filter: "{{ n }}") }{% endgraphql %}');

    expect(offenses).to.be.empty;
  });

  it('stays silent on a body that does not parse as GraphQL', async () => {
    const offenses = await run('{% graphql r %}{ unclosed {% endgraphql %}');

    expect(offenses).to.be.empty;
  });

  it('stays silent, and does not throw, when the docset publishes no schema', async () => {
    const offenses = await run('{% graphql r %}{ nope }{% endgraphql %}', withoutSchema);

    expect(offenses).to.be.empty;
  });

  it('points at the offending text inside the .liquid file', async () => {
    const source = '<p>before</p>\n{% graphql r %}\n{ nope }\n{% endgraphql %}\n';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('nope');
  });

  it('points at the offending text on a CRLF file', async () => {
    const source = '<p>before</p>\r\n{% graphql r %}\r\n{ nope }\r\n{% endgraphql %}\r\n';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('nope');
  });

  it('points at the offending text when the body starts on the tag line', async () => {
    const source = '{% graphql r %}{ nope }{% endgraphql %}';

    const offenses = await run(source);

    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('nope');
  });

  it('reports each inline body in a file, at its own position', async () => {
    const source =
      '{% graphql a %}{ nope }{% endgraphql %}\n{% graphql b %}{ alsoNope }{% endgraphql %}';

    const offenses = await run(source);

    expect(offenses).to.have.length(2);
    expect(offenses.map((o) => source.slice(o.start.index, o.end.index)).sort()).to.eql([
      'alsoNope',
      'nope',
    ]);
  });

  it('reports an inline body nested inside another tag', async () => {
    const source = '{% if true %}\n  {% graphql r %}{ nope }{% endgraphql %}\n{% endif %}';

    const offenses = await run(source);

    expect(offenses).to.have.length(1);
    expect(source.slice(offenses[0].start.index, offenses[0].end.index)).to.equal('nope');
  });

  it('is a recommended ERROR, matching GraphQLCheck for the same finding', async () => {
    expect(GraphQLInlineCheck.meta.severity).to.equal(Severity.ERROR);
    expect(GraphQLInlineCheck.meta.docs.recommended).to.be.true;
  });
});
