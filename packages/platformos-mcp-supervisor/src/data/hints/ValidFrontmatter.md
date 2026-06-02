{{#if category}}{{category_summary}}{{else}}Frontmatter validation failed.{{/if}}

STEP 1 — Identify the category.
  missing_required → A required key for this file type is absent.
  unknown_field    → A key not recognized for this file type.
  deprecated_field → Key is recognized but deprecated. Replace per the schema's deprecation guidance.
  invalid_enum     → Value is outside the allowed set for this key.
  layout_missing   → Layout file referenced does not exist on disk.
  layout_false     → `layout: false` falls back to the default layout (silent footgun).
  association_missing → Auth policy / notification reference does not match a file.
  home_deprecated  → File should be renamed `index.html.liquid`.

STEP 2 — Apply the fix.
{{#if field}}
  Field involved: `{{field}}`{{#if file_type}} (file type: {{file_type}}){{/if}}.
{{/if}}
{{#if category_fix}}
  → {{category_fix}}
{{else}}
  → Read the message; the upstream check names the exact field and the expected shape.
{{/if}}

STEP 3 — Re-validate.
  CALL `validate_code` on this file after the fix.
  FAIL → review the file's domain conventions via `domain_guide`.

Frontmatter rules vary per file type (Page, Layout, Partial, Form Configuration, Email, SMS, API Call, Authorization Policy, Migration). When in doubt: scaffold tool generates correct frontmatter for the chosen file type.
