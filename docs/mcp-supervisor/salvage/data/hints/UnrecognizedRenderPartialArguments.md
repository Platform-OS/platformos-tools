Argument '{{unrecognized_param}}' passed to '{{partial_name}}' is not declared in its {% doc %} block.

STEP 1 — Open the partial and read its {% doc %} block.
  File: app/views/partials/{{partial_name}}.liquid
  Every argument passed must match a declared @param:
    @param name {string} — required
    @param [name] {string} — optional

STEP 2 — Choose one fix:
  A) Remove the unrecognized argument from the calling tag in THIS file.
     The partial does not read it, so passing it is dead data.
  B) Add the missing @param to the partial's {% doc %} block.
     Use this if the partial should read the value.
  C) Rename the argument to match an existing @param.
     Use this if the name was a typo.

MUST NOT: Leave the unrecognized argument in place assuming the partial will figure it out — @param is the contract, undeclared arguments are silently dropped.
MUST NOT: Delete all @param declarations to silence the check — that removes the interface documentation other callers rely on.
