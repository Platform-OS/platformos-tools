import { GraphQLDocumentNode } from './parse';

/** One variable a platformOS GraphQL operation declares. */
export interface GraphqlVariable {
  name: string;
  /**
   * Whether the call site MUST pass it: a non-null type (`$id: ID!`) with no default.
   * `$id: ID! = "1"` is not required — the default supplies it.
   */
  required: boolean;
}

/**
 * The variables a GraphQL document's operations declare — what a
 * `{% graphql res = 'name', … %}` call site is allowed, and obliged, to pass.
 *
 * **`undefined` and `[]` are different answers.** `undefined` means the document did
 * not parse, so nothing is known about its variables and a caller must report
 * nothing; `[]` means it parsed and declares none, so every named argument at the
 * call site is unknown. Collapsing the two turns an unrelated syntax error into a
 * pile of false "Unknown parameter" offenses.
 *
 * Takes the {@link GraphQLDocumentNode} rather than a string, so the caller passes the
 * parse its `AppFile` already holds.
 */
export function extractGraphqlVariables(
  document: GraphQLDocumentNode,
): GraphqlVariable[] | undefined {
  if (!document.document) return undefined;

  const variables: GraphqlVariable[] = [];
  for (const definition of document.document.definitions) {
    if (definition.kind !== 'OperationDefinition') continue;
    for (const variableDefinition of definition.variableDefinitions ?? []) {
      variables.push({
        name: variableDefinition.variable.name.value,
        required:
          variableDefinition.type.kind === 'NonNullType' && variableDefinition.defaultValue == null,
      });
    }
  }

  return variables;
}
