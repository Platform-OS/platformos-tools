Property '{{property_name}}' cannot be verified on '{{object_name}}'.

STEP 1 — Check the traversal path.
  GraphQL result?    → result comes from {% graphql g = '...' %}
                       Use: g.records.results[i].{{property_name}}
                       NOT: g.results or g.{{property_name}} directly
  Function result?   → inspect the called partial's return structure
  Direct object?     → CALL lookup (hover mode) at the object name to see available properties

STEP 2 — Declare type if in a partial/command/query.
  Add at the TOP of this file:
    {% doc %}
      @param {object} {{object_name}}
    {% enddoc %}
  This tells the linter the parameter type, silencing the warning.

Fixing existing code: if the property access is genuinely wrong (e.g. from a different platform), replace it with the correct platformOS data path.
Building new code: verify the data structure matches your GraphQL query or function return value.