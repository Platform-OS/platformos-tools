Module path '{{name}}' cannot be resolved.
{{#if has_suggestion}}
  Module is installed but path is wrong.
  Fix '{{name}}' in THIS file to one of the available paths (see suggestion field).
  MUST NOT create a file at this path — module files are not project files.
{{else}}
  Path is unresolvable.
  CALL project_map to see installed modules and their available function paths.
{{/if}}
MUST NOT: Remove the {% {{tag}} %} call — the feature silently breaks.