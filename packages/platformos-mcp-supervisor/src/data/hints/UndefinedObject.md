'{{var_name}}' is undefined in this context.

STEP 1 — Identify what '{{var_name}}' should be.
  Context data?       → Use context.{{var_name}} — common properties:
                        context.params          (URL/form parameters)
                        context.session         (session data)
                        context.current_user    (authenticated user, nil if guest)
                        context.page, context.location, context.environment
  GraphQL result?     → {% graphql {{var_name}} = 'queries/...' %} then access {{var_name}}.records.results
  Function result?    → {% function {{var_name}} = 'lib/...' %} then use return value
  Loop variable?      → {% for {{var_name}} in collection %} — loop variables are declared by the
                        for-tag itself. If linter fires here, '{{var_name}}' is likely used
                        outside the loop body (after {% endfor %}).
  Passed by caller?   → You are likely in a partial — see UndefinedObject-partial hint.

STEP 2 — Apply the fix.
{{#if has_suggestion}}
  → APPLY: {{suggestion}}
{{else}}
  → NO suggestion: check hover_docs field, or call domain_guide for the relevant domain.
{{/if}}

Do not use bare '{{var_name}}' — it must come from an assignment, context, GraphQL result, function return, loop variable, or caller parameter.
Fixing existing code: if '{{var_name}}' is from another platform, replace it with the correct platformOS data source.
Building new code: identify where the data comes from and wire it in before using it.