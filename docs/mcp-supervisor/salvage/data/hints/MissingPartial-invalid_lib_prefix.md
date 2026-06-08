'{{name}}' is not a valid path: the literal `lib/` prefix is invalid.

WHY — `function` tag paths resolve relative to the partial search paths declared by
`@platformos/platformos-common` (`['app/views/partials', 'app/lib']`), not project root.
So `{{name}}` expands to `app/lib/{{name}}`, i.e. `app/lib/lib/{{corrected_name}}`,
which never exists. The `lib/` prefix is NOT optional — it is wrong everywhere
(from pages, partials, commands, queries — caller location does not matter).

FIX — drop the `lib/` prefix in this file:
  {% {{tag}} ... = '{{name}}', ... %}            ← invalid
  {% {{tag}} ... = '{{corrected_name}}', ... %}  ← correct

The corrected call resolves to `{{create_path}}` — verify that file exists before
relying on the rename. If it does not, create it (use the `scaffold` tool for a
full feature) and re-run validate_code.

MUST NOT: create a file at `app/lib/{{name}}.liquid` to satisfy the linter —
that path is unreachable by platformOS at runtime.
