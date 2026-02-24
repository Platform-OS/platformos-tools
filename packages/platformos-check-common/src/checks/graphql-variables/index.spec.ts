import { expect, describe, it } from 'vitest';
import { GraphQLVariablesCheck } from '.';
import { check } from '../../test';

const GRAPHQL_WITH_REQUIRED = `
  query MyQuery($content: String!) {
    records(filter: { table: { value: "posts" } }) {
      results {
        id
      }
    }
  }
`;

const GRAPHQL_WITH_OPTIONAL = `
  query MyQuery($content: String) {
    records(filter: { table: { value: "posts" } }) {
      results {
        id
      }
    }
  }
`;

describe('Module: GraphQLVariablesCheck', () => {
  it('reports a missing required parameter', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create' %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_REQUIRED,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      'Required parameter content must be passed to GraphQL call',
    );
  });

  it('does not report when all required parameters are provided', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create', content: 'hello' %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_REQUIRED,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.be.empty;
  });

  it('does not report when the parameter is optional', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create' %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_OPTIONAL,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.be.empty;
  });

  it('does not report when args is used (hash splat)', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create', args: object %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_REQUIRED,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.be.empty;
  });

  it('does not report unknown parameter when args is used', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create', args: object, extra: 'x' %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_REQUIRED,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.be.empty;
  });

  it('reports an unknown parameter when args is not used', async () => {
    const files = {
      'app/views/partials/page.liquid': `{% graphql r = 'create', content: 'hello', unknown: 'x' %}`,
      'app/graphql/create.graphql': GRAPHQL_WITH_REQUIRED,
    };

    const offenses = await check(files, [GraphQLVariablesCheck]);

    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal('Unknown parameter unknown passed to GraphQL call');
  });
});
