Argument `{{argument}}` passed twice to `{% {{tag_kind}} '{{partial}}' %}`.

STEP 1 — Read the call site.
  Open the file at the reported line and locate the `{% {{tag_kind}} %}` call. Two instances of `{{argument}}: …` exist in the same call.

STEP 2 — Decide which value to keep.
  → If the values are identical, delete one of the duplicates.
  → If the values differ, this is a logic bug: the second one wins (Liquid's last-key-wins semantics) but the intent was likely to pass two DIFFERENT named args. Rename one to its real name.

STEP 3 — Apply the fix.
  Remove the duplicate occurrence of `{{argument}}: …`. Trailing comma may need cleaning up.

STEP 4 — Re-validate.
  CALL `validate_code` on this file after the fix.

Why it matters: silently dropping the first value usually masks an off-by-one mistake (two args meant to be different but typed the same). The check fires when the partial-call signature has the duplicate, regardless of value.
