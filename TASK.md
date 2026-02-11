goal: >
  Implement property-aware autocomplete and static validation for variables
  defined in the current file.

pre_implementation:
  requirement: >
    Before implementing any code, analyze the existing codebase and present
    a summary of planned changes for review.
  analysis_tasks:
    - Identify existing autocomplete logic and inference mechanisms
    - Review current ThemeChecks, especially unknown-filter
    - Determine where variable shape inference already exists or must be added
    - Evaluate GraphQL document resolution via DocumentLocator
  output:
    description: Human-readable summary of pending changes
    must_include:
      - Files and components to be modified
      - New files or ThemeChecks to be introduced
      - Shared data structures or models to be added or extended
      - Assumptions or limitations
      - Potential risks or edge cases
  constraint: Do not proceed with implementation until this summary is shown and explicitly confirmed

supported_variable_sources:
  - assign
  - hash_assign
  - graphql

file_resolution:
  mechanism: DocumentLocator

property_autocomplete:
  behavior:
    - Infer variable structure from JSON literals and parse_json
    - Track mutations via hash_assign
    - Infer response shape from GraphQL selection sets
    - Support nested dot access (a.b.c)
    - Stop suggesting properties once a primitive is reached
    - Do not guess when structure cannot be inferred

theme_check:
  name: unknown-property
  based_on: unknown-filter
  purpose: >
    Validate property access only when the variable's shape can be inferred
    with confidence.
  shared_model: >
    Must reuse the same inferred structure model used by autocomplete.

  emit_error_when:
    - Base variable is resolvable
    - Variable structure is inferred with confidence
    - Accessed property does not exist at the given path

  do_not_emit_error_when:
    - Variable value is dynamic or opaque
    - Structure cannot be inferred
    - Variable originates from unknown filters or external runtime data
    - Access path passes through an unknown node

validation_examples:
  - description: Known structure, valid and invalid access
    code:
      - "assign a = '{\"a\": 5}'"
      - "assign x = a.a    # valid"
      - "assign x = a.b    # error: unknown property \"b\" on variable \"a\""

  - description: Unknown structure
    code:
      - "assign a = some_dynamic_value"
      - "assign x = a.b    # no error (structure cannot be inferred)"

  - description: Nested invalid access
    code:
      - "assign a = '{\"a\": { \"b\": 1 }}'"
      - "assign x = a.a.c  # error: unknown property \"c\" on a.a"

  - description: Property access on primitive
    code:
      - "assign a = '{\"a\": 5}'"
      - "assign x = a.a.b  # error: property access on primitive value"

graphql_validation:
  behavior:
    - Resolve GraphQL documents using DocumentLocator
    - Infer response shape from the selection set
    - Emit errors only when accessed fields are not present in the selection

acceptance_criteria:
  - Analysis summary is shown before implementation begins
  - ThemeCheck and autocomplete share a single inference model
  - Errors are shown only when inference is possible
  - No false positives for dynamic or unknown values
  - Error messages identify variable name, invalid property, and full access path
