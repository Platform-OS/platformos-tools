import { GraphQLError } from 'graphql';
import { DocumentNode, Kind, Source, StringValueNode, parse } from 'graphql/language';

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
  let document: DocumentNode;
  try {
    document = parse(content);
  } catch (error) {
    return { type: 'Document', content, syntaxError: asGraphQLError(error) };
  }

  const unparseable = rejectedByThePlatform(content, document);
  if (unparseable) return { type: 'Document', content, syntaxError: unparseable };

  return { type: 'Document', content, document };
}

/**
 * What `graphql` parses and the PLATFORM'S parser does not.
 *
 * Two implementations of one language: graphql-js here, the `graphql-c_parser` gem there.
 * Every case is MEASURED against a live deploy, not read off the spec, which is what neither
 * side ships. A {@link syntaxError} with no {@link document} is the literal truth: the
 * platform has no parse of the file, and rejects the whole changeset over it.
 */
function rejectedByThePlatform(content: string, document: DocumentNode): GraphQLError | undefined {
  // Anywhere, not just the front — ignored whitespace to graphql-js at any position, an
  // invalid token to the platform at any position. Measured at six.
  const bom = content.indexOf('﻿');
  if (bom !== -1) {
    return new GraphQLError(
      'A byte order mark is not valid GraphQL — the platform rejects the file. Remove it and save as UTF-8 without a BOM.',
      { source: new Source(content), positions: [bom] },
    );
  }

  const description = firstExecutableDescription(document);
  if (description) {
    return new GraphQLError(
      `A description is not allowed on ${description.subject} — the platform rejects the file. Use a "#" comment instead.`,
      { nodes: description.node },
    );
  }

  return undefined;
}

/**
 * The first description on an EXECUTABLE definition, in document order.
 *
 * graphql-js ships the operation-descriptions proposal unconditionally and offers no
 * `ParseOptions` flag to disable it, which is why this cannot be a parser setting.
 * TYPE-SYSTEM definitions are skipped: a description is legal there in both grammars.
 */
function firstExecutableDescription(
  document: DocumentNode,
): { node: StringValueNode; subject: string } | undefined {
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      if (definition.description) {
        return { node: definition.description, subject: `a ${definition.operation}` };
      }
      for (const variable of definition.variableDefinitions ?? []) {
        if (variable.description) {
          return { node: variable.description, subject: 'a variable definition' };
        }
      }
    } else if (definition.kind === Kind.FRAGMENT_DEFINITION && definition.description) {
      return { node: definition.description, subject: 'a fragment definition' };
    }
  }

  return undefined;
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
