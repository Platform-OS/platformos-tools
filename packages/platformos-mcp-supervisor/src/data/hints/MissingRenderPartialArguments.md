Required @param '{{missing_param}}' is not passed to '{{partial_name}}'.

STEP 1 — Open the partial and read its {% doc %} block.
  File: app/views/partials/{{partial_name}}.liquid
  A parameter is required when its name has no square brackets:
    @param name {string} — required (must be passed)
    @param [name] {string} — optional (may be omitted)

STEP 2 — Fix the calling tag in THIS file.
  Add the missing argument:
    {% render '{{partial_name}}', {{missing_param}}: value %}
    {% function x = '{{partial_name}}', {{missing_param}}: value %}
  The argument name must exactly match the @param name.

MUST NOT: Remove the @param declaration from the partial to silence this — the partial will silently receive nil.
MUST NOT: Use a different argument name — @param names are the contract.