import { buildSchema, GraphQLSchema } from 'graphql';

/**
 * The last SDL string we built a schema from, and the schema we built. ONE entry
 * is enough: the docset hands the same SDL to every check for the whole life of
 * the process, so a second entry could only ever be dead weight (a schema built
 * from the platformOS SDL is not small).
 */
let lastBuilt: { sdl: string; schema: GraphQLSchema } | undefined;

/**
 * Build a `GraphQLSchema` from SDL, reusing the previous result while the SDL is
 * unchanged.
 *
 * The platformOS SDL is ~300 KB and `buildSchema` costs 45–85 ms on it. Both
 * GraphQL-aware checks used to pay that repeatedly within a single lint run —
 * `GraphQLCheck` once per `.graphql` file, `UnknownProperty` once per
 * `{% graphql %}` site — which on a real project is seconds of pure recompute
 * plus a schema-sized allocation thrown away each time.
 *
 * Sharing one instance is safe because consumers only read from it (`validate`,
 * `getQueryType`, `getMutationType`); nothing mutates a schema.
 *
 * Failures are NOT cached: a malformed SDL throws on every call, exactly as
 * calling `buildSchema` directly did. Callers keep whatever error handling they
 * had (`GraphQLCheck` lets it reach the run's error handler, `inferShapeFromGraphQL`
 * degrades to schema-less inference).
 */
export function buildGraphQLSchema(sdl: string): GraphQLSchema {
  if (lastBuilt?.sdl === sdl) return lastBuilt.schema;

  const schema = buildSchema(sdl);
  lastBuilt = { sdl, schema };
  return schema;
}
