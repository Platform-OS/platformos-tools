'{{name}}' does not exist.

STEP 1 — Determine the right fix.
  Fixing existing code:
    → Check if '{{name}}' is a typo. CALL project_map to see available partials — fix the path if a similar name exists.
    → If this reference is leftover from deleted/refactored code, remove the {% {{tag}} '{{name}}' %} tag entirely.
  Building new feature:
    → GOTO STEP 2 to create the missing file.
  Output came from scaffold:
    → Check scaffold output for exact path, do NOT rename scaffold files.

  COMMAND PHASE STRUCTURE — build / check / execute are inline phases of YOUR command.
    Each command lives at app/lib/commands/<feature>/<action>.liquid and orchestrates three
    sibling files in the same directory:
      app/lib/commands/contact_messages/create.liquid          ← orchestrator (calls build/check/execute below)
      app/lib/commands/contact_messages/create/build.liquid    ← inline phase (you write this)
      app/lib/commands/contact_messages/create/check.liquid    ← inline phase (you write this)
      app/lib/commands/contact_messages/create/execute.liquid  ← inline phase (you write this)
    Module helpers DO NOT supply build / check — there is no `modules/core/commands/build`
    or `modules/core/commands/check`. Write your own phase files; reference them as
    `commands/<feature>/<action>/build` etc. from the orchestrator.

  CORE MODULE EXECUTE SHORTCUT — only `modules/core/commands/execute` is exported.
    For a simple create/update/delete with no custom logic you can skip writing your own
    execute.liquid and call the core helper directly from the orchestrator:
    ```liquid
    function object = 'modules/core/commands/execute', mutation_name: 'contact_submissions/create', selection: 'record_create', object: object
    ```
    Use this when: single mutation, no extra steps. For everything else write your own
    execute.liquid in the same directory as build.liquid / check.liquid.
    Run `module_info(core, api)` for the full list of helpers core actually exports —
    `build` and `check` are NOT among them.

STEP 2 — Create '{{name}}'.
  Path: {{create_path}}
  Content guide:
    partial → Liquid/HTML fragment. Start with {% doc %} @param block if it receives variables.
    command → orchestrates build → check → execute via {% function %}. Returns hash with .valid and .errors.
    query   → thin wrapper: single {% function %} call around one {% graphql %} operation. Returns result hash.
  Tip: use scaffold tool when creating a full feature — it generates the full file set with correct wiring.

STEP 3 — Re-validate.
  CALL validate_code on THIS file after fixing or creating.
  FAIL (error persists) → path mismatch. Verify: {{create_path}} exists, spelling is exact, no extra slashes.

SCAFFOLDING — Writing multiple related files in sequence?
  Pass pending_files=["{{create_path}}"] to validate_code to suppress this error for files not yet written.
