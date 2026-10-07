import { DocumentNode, GraphQLSchema, NoDeprecatedCustomRule, validate } from 'graphql';

/** One deprecation a document uses, positioned at the deprecated name. */
export interface DeprecationProblem {
  /** The schema's own `@deprecated(reason:)` text, as graphql-js words it. */
  message: string;
  /** 0-indexed into the document, included. */
  startIndex: number;
  /** 0-indexed into the document, excluded. */
  endIndex: number;
}

/**
 * Every deprecated field, argument, enum value and input field a document uses.
 *
 * `NoDeprecatedCustomRule` is deliberately absent from graphql-js's `specifiedRules`, which is
 * why the checks running the default set report none of this. It is the only rule run here, so
 * a deprecation check and a validity check stay disjoint and neither can silence the other.
 *
 * The range is the NAME, not the node: a `Field`'s own range spans its alias and its whole
 * sub-selection, so a deprecated field with a large selection would be reported across every
 * line of it. Measured — `Field`, `Argument` and `ObjectField` all carry the name separately,
 * while an `EnumValue` is already just the value. `?? 0` follows `MissingTable` for a node that
 * carries no location at all.
 */
export function deprecationProblems(
  schema: GraphQLSchema,
  document: DocumentNode,
): DeprecationProblem[] {
  return validate(schema, document, [NoDeprecatedCustomRule]).map((error) => {
    const node = error.nodes?.[0];
    const name = node && 'name' in node ? node.name : undefined;
    const location = name?.loc ?? node?.loc;

    return {
      message: error.message,
      startIndex: location?.start ?? 0,
      endIndex: location?.end ?? 0,
    };
  });
}
