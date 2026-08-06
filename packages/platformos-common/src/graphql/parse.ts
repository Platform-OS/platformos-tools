import { GraphQLError } from 'graphql';
import { DocumentNode, parse } from 'graphql/language';

/**
 * A `.graphql` document as the toolchain holds it: the source, its parse, and the
 * syntax error when there is no parse.
 *
 * **The parse is a value, not an exception.** A `.graphql` file that does not compile
 * is a normal state — it is what `GraphQLCheck` reports on — so every consumer gets
 * the same object whether or not the document is valid, and asks which of
 * {@link document} / {@link syntaxError} is present. That is also why this is not the
 * `Error` an {@link Parser} may return: an `Error` AST would take the file out of the
 * check pipeline, and the check is the whole point.
 *
 * {@link content} is kept because the offense positions are byte offsets into the
 * SOURCE (`lineToRange`), which the parsed document alone cannot give back.
 */
export interface GraphQLDocumentNode {
  /** The discriminant, so this narrows like every other AST in the toolchain. */
  type: 'Document';

  /** The source, verbatim. */
  content: string;

  /** The parsed operation, or `undefined` when {@link content} is not valid GraphQL. */
  document?: DocumentNode;

  /** Why it did not parse, with the line the GraphQL parser reports. */
  syntaxError?: GraphQLError;
}

/**
 * Parse a GraphQL document.
 *
 * This is THE GraphQL parse for the toolchain, in both of the shapes platformOS
 * needs it:
 *
 * - a `.graphql` FILE is parsed through this by the {@link Parsers} an `App` is built
 *   with, so its `AppFile` memoizes the result and the file is parsed once until its
 *   source changes, however many call sites name it;
 * - an INLINE `{% graphql res %}…{% endgraphql %}` body has no file and no `AppFile`,
 *   so its caller calls this directly.
 *
 * There is deliberately no cache here. The file case already has one — the `AppFile`
 * that owns the source — and a second, content-keyed one behind it would be a
 * different answer to "what is this file's parse", which is the drift the App model
 * exists to prevent.
 */
export function parseGraphql(content: string): GraphQLDocumentNode {
  try {
    return { type: 'Document', content, document: parse(content) };
  } catch (error) {
    return { type: 'Document', content, syntaxError: asGraphQLError(error) };
  }
}

/**
 * Whether `ast` is a parsed GraphQL document — for a caller holding the
 * `AST[SourceCodeType] | Error` union an `AppFile` exposes.
 */
export function isGraphqlDocument(ast: unknown): ast is GraphQLDocumentNode {
  return (
    typeof ast === 'object' && ast !== null && (ast as GraphQLDocumentNode).type === 'Document'
  );
}

/** `graphql`'s `parse` throws `GraphQLError`; anything else is kept, not swallowed. */
function asGraphQLError(error: unknown): GraphQLError {
  if (error instanceof GraphQLError) return error;
  return new GraphQLError(error instanceof Error ? error.message : String(error));
}
