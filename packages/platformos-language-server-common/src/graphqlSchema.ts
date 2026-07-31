import { buildSchema, GraphQLSchema } from 'graphql';
import { createBoundedCache } from '@platformos/platformos-check-common';

/**
 * Build a `GraphQLSchema` from SDL, reusing the previous result while the SDL is
 * unchanged — the same one-entry cache check-common keeps for its own checks (see
 * `utils/graphql-schema.ts` there for the performance rationale), but built with
 * THIS package's `graphql`.
 *
 * A `GraphQLSchema` may only be inspected by the `graphql` module record that
 * built it. `isNonNullType`/`isListType`/`getNamedType` identify types with
 * `instanceOf`, which throws `Cannot use GraphQLNonNull "…" from another module
 * or realm` when handed a type from a different record — and, in a production
 * bundle where `instanceOf` degrades to a plain `instanceof`, silently answers
 * `false` instead, which is worse: an array field is then classified as a
 * primitive and its item fields disappear from hover and completions.
 *
 * Two records is the normal case here, not a pathological one: check-common is
 * consumed as built CJS while this package's sources are transformed separately
 * (vitest does exactly this), so importing check-common's `buildGraphQLSchema`
 * hands us a schema from its record. `GraphQLFieldHoverProvider` and
 * `GraphQLFieldCompletionProvider` avoid the same hazard by `require`-ing graphql
 * at runtime; here it is enough to build and inspect within one record.
 */
const schemaCache = createBoundedCache<GraphQLSchema>(1);

export function buildGraphQLSchema(sdl: string): GraphQLSchema {
  // Failures are NOT cached: a malformed SDL throws on every call, exactly as
  // calling `buildSchema` directly did.
  return schemaCache(sdl, () => buildSchema(sdl));
}
