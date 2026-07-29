import { describe, expect, it } from 'vitest';
import { GraphQLObjectType } from 'graphql';

import { buildGraphQLSchema } from './graphql-schema';

const SDL_A = `
  type Query {
    records: [Record!]!
  }

  type Record {
    id: ID!
    name: String
  }
`;

const SDL_B = `
  type Query {
    people: [Person!]!
  }

  type Person {
    id: ID!
  }
`;

describe('Unit: buildGraphQLSchema', () => {
  it('returns the very same schema instance for an unchanged SDL string', () => {
    expect(buildGraphQLSchema(SDL_A)).toBe(buildGraphQLSchema(SDL_A));
  });

  it('returns the same instance for an equal SDL passed as a different string object', () => {
    const copy = SDL_A.split('').join('');

    expect(buildGraphQLSchema(copy)).toBe(buildGraphQLSchema(SDL_A));
  });

  it('builds a usable schema', () => {
    const queryType = buildGraphQLSchema(SDL_A).getQueryType();

    expect(queryType).toBeInstanceOf(GraphQLObjectType);
    expect(Object.keys(queryType!.getFields())).toEqual(['records']);
  });

  it('builds a new schema when the SDL changes', () => {
    const first = buildGraphQLSchema(SDL_A);
    const second = buildGraphQLSchema(SDL_B);

    expect(second).not.toBe(first);
    expect(Object.keys(second.getQueryType()!.getFields())).toEqual(['people']);
  });

  it('retains only one schema, so alternating SDLs rebuild rather than accumulate', () => {
    const first = buildGraphQLSchema(SDL_A);
    buildGraphQLSchema(SDL_B);

    expect(buildGraphQLSchema(SDL_A)).not.toBe(first);
  });

  it('throws on malformed SDL every time, and never caches the failure as a success', () => {
    expect(() => buildGraphQLSchema('type Query {')).toThrow();
    expect(() => buildGraphQLSchema('type Query {')).toThrow();
    expect(buildGraphQLSchema(SDL_A).getQueryType()).toBeInstanceOf(GraphQLObjectType);
  });
});
