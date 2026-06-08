Translation key '{{key}}' not found in translation files.

NOTE: If you are creating translation files as part of a multi-file plan, pass pending_translations
  (from validate_intent) to validate_code — this suppresses TranslationKeyExists for keys that
  will exist once the plan is written to disk.
  
IF Translations show "translation missing" even though the key exists in the YAML file.
Root cause: The YAML file is missing the required top-level language key.

```yaml
en:
  app:
    contact_form:
      title: "..."
```

OTHERWISE:

STEP 1 — Check the suggestion field for a typo fix.
  HAS suggestion (Did you mean '...'?):
    → Fix '{{key}}' in THIS file to the suggested key. Do NOT create a new key. STOP.
  NO suggestion: → GOTO STEP 2.

STEP 2 — Add the missing translation key.
  File: app/translations/en.yml
  Path: {{yaml_path_comment}}
  Add at the correct nesting level:
{{yaml_snippet}}
  Also add to all other locale files (e.g. app/translations/pl.yml) with localized text.

STEP 3 — Apply: '{{key}}' | t

MUST NOT: Remove the | t filter or replace translations with hardcoded text to silence this.
MUST NOT: Create a new key if STEP 1 found a suggestion — fix the typo instead.
