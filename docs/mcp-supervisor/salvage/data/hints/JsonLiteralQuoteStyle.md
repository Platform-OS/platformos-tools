Inline object/array literals must use double-quoted strings.

STEP 1 — Identify the literal.
  Object literal: `{% assign x = { 'k': 'v' } %}` — both keys and values use single quotes.
  Array literal:  `{% assign xs = [ 'a', 'b' ] %}` — string items use single quotes.

STEP 2 — Apply the fix.
  → Change every single-quoted string inside `{ … }` and `[ … ]` to double-quoted:
    BEFORE: `{% assign hash = { 'name': 'value' } %}`
    AFTER:  `{% assign hash = { "name": "value" } %}`
  → JSON literal grammar requires double quotes — single quotes break round-trip with `{% parse_json %}` consumers and external JSON tooling.

STEP 3 — Re-validate.
  CALL `validate_code` on this file after the fix.
  FAIL → another single-quoted string remains nested inside the literal; widen the search to nested `{ … }` / `[ … ]`.

Note: this rule does NOT apply to plain Liquid string assignments (`{% assign x = 'hello' %}` is fine). Only inline JSON-shaped literals require double quotes.
