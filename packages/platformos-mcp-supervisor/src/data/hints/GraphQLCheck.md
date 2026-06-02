{{#if category_unused_var}}
Variable '{{var_name}}' is declared but never used in this operation.
  Remove the variable from the operation signature, or use it in the query body.
  WRONG: query myQuery($id: ID!, $unused: String) { ... }
  RIGHT: query myQuery($id: ID!) { ... }
{{/if}}
{{#if category_unknown_field_record}}
'{{field_name}}' is not a direct field on Record.
  Record type only has: id, table, created_at, updated_at, user_id, external_id.
  Access custom schema properties via:
    property(name: "{{field_name}}") — returns a single property value
    properties_object — returns all custom properties as a hash
  Example: records { results { id  title: property(name: "title") } }
  OR:      records { results { id  properties_object } }
{{/if}}
{{#if category_unknown_field_other}}
'{{field_name}}' is not a field on '{{type_name}}'.
  Check the GraphQL schema for available fields on '{{type_name}}'.
  → Use lookup tool for exact type signatures.
{{/if}}
{{#if category_type_mismatch_filter}}
Variable '{{var_name}}' has type '{{actual_type}}' but the field expects '{{expected_type}}'.
  Filter inputs are objects, not plain strings. Wrap the value — do NOT change the variable type:
    StringFilter:    { value: "text" } — fields: value, contains, starts_with, ends_with, not_eq
    IDFilter:        { value: $id }   — keep variable type as ID!
    UniqIdFilter:    { value: $id }   — keep variable type as ID!
    PropertyFilterInput: { name: "field", value: "val" } — fields: name, value, contains, starts_with, ends_with, exists, not_eq
  WRONG: table: "blog_post"              RIGHT: table: { value: "blog_post" }
  WRONG: id: $id                         RIGHT: id: { value: $id }
  WRONG: name: $name                     RIGHT: name: { value: $name }
{{/if}}
{{#if category_type_mismatch_other}}
Variable '{{var_name}}' has type '{{actual_type}}' but the field expects '{{expected_type}}'.
  Change the variable type in the operation signature to match what the field expects.
  → Use lookup tool for exact type signatures.
{{/if}}
{{#if category_generic}}
  → Use lookup tool for exact type signatures.
  → Use domain_guide({ domain: "graphql", section: "gotchas" }) for full reference.
  Common platformOS GraphQL gotchas:
    Record only has: id, table, created_at, updated_at, user_id, external_id.
    Custom props via property(name: "field") or properties_object.
    Filter inputs are objects: table: { value: "blog_post" }, not table: "blog_post".
    SortOrderEnum is unquoted: ASC or DESC (not "asc" / "desc").
{{/if}}