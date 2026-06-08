{{#if is_function_call}}
Function call metadata params: {% function %} calls must match the target's declared @param parameters.
"Required parameter X must be passed" — the target query/command declares @param X; your function call must pass it.
"Unknown parameter X passed" — your function call passes X but the target does not declare it.
MUST read the target file's {% doc %} block for @param declarations.
A parameter is required when its name has no square brackets:
  @param name {string} — required (must be passed)
  @param [name] {string} — optional (may be omitted)
The target is a query wrapper or command — NOT a partial. Look in app/lib/queries/ or app/lib/commands/.
If a parameter is optional, the target should assign a default: assign param = param | default: fallback_value
→ Use enrich_error or lookup for the target file's parameter declarations.
{{else}}
Render call metadata params: {% render %} calls must match the partial's declared @param parameters.
"Required parameter X must be passed" — the partial declares @param X; your render call must pass it.
"Unknown parameter X passed" — your render call passes X but the partial does not declare it.
MUST read the target partial's {% doc %} block for @param declarations.
A parameter is required when its name has no square brackets:
  @param name {string} — required (must be passed)
  @param [name] {string} — optional (may be omitted)
Match the declared type exactly:
  Declared errors: [] → pass errors: [] (NOT errors: null)
  Declared title: "" → pass title: "" or title: "value"
  Declared config: {} → pass config: {} or config: hash
Types in @param MUST be lowercase: {string}, {number}, {boolean}, {object}, {array}, {untyped}.
  WRONG: @param product {Object} → triggers ValidDocParamType
  RIGHT: @param product {object}
NEVER pass null for a typed parameter — use the matching empty value ([], {}, "", false).
NEVER invent parameters not declared in the partial's metadata block.
→ Use enrich_error or lookup for the partial's parameter declarations.
{{/if}}
