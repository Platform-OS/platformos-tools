import { buildSchema, GraphQLSchema } from 'graphql';
import { createBoundedCache } from './bounded-cache';

/**
 * Build a `GraphQLSchema` from SDL, reusing the previous result while the SDL is
 * unchanged.
 *
 * The platformOS SDL is ~300 KB and `buildSchema` costs 45-85 ms on it, which both
 * GraphQL-aware checks would otherwise pay per `.graphql` file and per `{% graphql %}`
 * site — seconds of pure recompute on a real project.
 *
 * ONE entry is enough: the docset hands the same SDL to every check for the whole
 * life of the process, so a second entry could only ever be dead weight.
 *
 * Sharing one instance is safe because consumers only read from it (`validate`,
 * `getQueryType`, `getMutationType`); nothing mutates a schema.
 *
 * NOT for use outside this package: a `GraphQLSchema` may only be inspected by the
 * `graphql` module record that built it, and check-common is often loaded as built
 * CJS while its consumers are transformed separately. Sibling packages keep their
 * own builder for that reason — see `language-server-common/src/graphqlSchema.ts`.
 */
const schemaCache = createBoundedCache<GraphQLSchema>(1);

export function buildGraphQLSchema(sdl: string): GraphQLSchema {
  // Failures are NOT cached: a malformed SDL throws on every call, exactly as
  // calling `buildSchema` directly did. Callers keep whatever error handling they
  // had (`GraphQLCheck` lets it reach the run's error handler,
  // `inferShapeFromGraphQL` degrades to schema-less inference).
  return schemaCache(sdl, () => buildSchema(sdl));
}
