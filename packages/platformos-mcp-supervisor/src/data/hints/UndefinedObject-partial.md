'{{var_name}}' is a parameter — you are in a partial and it must be passed by the caller.

STEP 1 — Declare the parameter in THIS file.
  Add a {% doc %} block at the TOP of this file (before any code):
    {% doc %}
      @param {untyped} {{var_name}}
    {% enddoc %}
  Correct types: {string}, {number}, {boolean}, {object}, {array}.
  This declaration tells the linter the parameter is intentionally received from the caller.

STEP 2 — Verify the caller passes '{{var_name}}'.
{{#if has_suggestion}}
  → APPLY: {{suggestion}}
{{else}}
  → Use lookup or enrich_error to find every caller of this file.
  For each caller, confirm it passes the argument:
    {% render 'this/partial', {{var_name}}: some_value %}
    {% function x = 'this/partial', {{var_name}}: some_value %}
  IF caller does NOT pass it: fix the caller — add the missing argument.
{{/if}}

MUST NOT: Prefix '{{var_name}}' with context. — it is a parameter, not a context variable.
MUST NOT: Remove the reference to silence this error — the feature silently breaks.
MUST NOT: Rename '{{var_name}}' without also updating every caller.