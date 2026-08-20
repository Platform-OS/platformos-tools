# @platformos/liquid-html-parser

## 0.1.0

### Minor Changes

- e3a7fb0: A space between a variable and its key path is a PARSE error on the platform, in a write target only.

  `{% assign h ['k'] = 9 %}` parsed here and is refused by platformOS. Measured against
  `/api/app_builder/liquid_exec` and, because a syntax claim is only settled by the converter,
  against `pos-cli deploy --dry-run` — which REJECTS it 2/2 with its space-free control accepted.
  A converter rejection fails the WHOLE changeset, so this was a false approval with the same
  blast radius as `{% layout %}`: the gate said `must_fix_before_write: false` and the deploy took
  every other file down with it.

  The platform's own rule is one regex — `LHS_PATTERN` in `app/lib/liquify/tags/hash_assignable.rb`:

  ```ruby
  MIXED_KEYS_PATTERN = '(?:\.[\w\-]+|\[.+?\])+'
  LHS_PATTERN        = "(#{VARIABLE_NAME})(#{MIXED_KEYS_PATTERN})?"
  ```

  There is no `\s*` between the name and the key path, and the alternation covers `.foo` as well as
  `[…]`. So the constraint is **no whitespace between a variable and the start of its key path**, both
  accessors — not "no space before a subscript", which is how it was filed. Three tags share that
  pattern, and all three were affected, each with its own error text:

  ```liquid
  {% assign h ['k'] = 9 %}        Syntax Error in 'assign'
  {% assign h .k = 9 %}           Syntax Error in 'assign'
  {% hash_assign h ['k'] = 9 %}   Syntax Error in 'hash_assign'
  {% function r ['k'] = 'p' %}    Invalid syntax for function tag
  {% assign a ['z'] << 'x' %}     Syntax Error in 'assign'      <- the append operator too
  ```

  **Scoped to write targets, and that is the whole design.** The identical spelling in a READ resolves
  correctly on the platform, so narrowing the shared `lookup` rule would have traded one false approval
  for six false blocks — strictly the worse bug, since a false block cannot be overridden:

  ```liquid
  {{ h ['k'] }}   {{ h.a [0] }}   {{ h[ 'k' ] }}
  {% assign v = h ['k'] %}   {% if h ['k'] %}   {% echo h ['k'] %}
  ```

  `lookup` and `liquidVariableLookup` are therefore untouched; `assignTarget` and the `hash_assign` /
  `function` markups take a new target-only rule. `{% liquid %}` bodies inherit it, because that
  grammar only redefines `space`. The AST shape is unchanged, so stage 2, the printer and the language
  server needed no change — the two stage-1 additions are passthrough mappings.

  **A space INSIDE the brackets stays legal**, because `\[.+?\]` matches it, and so does a spaced
  bracket that follows another bracket — `h['a'] ['b']` assigns. Both were measured rather than
  assumed, and the first version of this change refused the second one: a false block, caught only by
  re-checking every spelling against the instance instead of trusting the unit tests.

  The printer now emits a refused target VERBATIM. It used to repair the spacing by accident, which hid
  the error from anyone who formatted and left it in place for everyone who did not.

  Known gap, pinned rather than left implicit: `{% assign h.a ['b'] = 9 %}` — a spaced bracket after a
  DOT — is still accepted and the platform refuses it. Expressing "spaced bracket only after a bracket"
  needs a recursive chain that would replace the flat `lookups` iteration the stage-1 mapping indexes,
  so it stays as it was, with a test asserting today's behaviour so it cannot be mistaken for covered.

  Verified on a real 2 768-file application: `pos-cli check` reports 13 225 offenses over 2 002 files,
  byte-identical to before, and `LiquidHTMLSyntaxError` still exactly 122 — no new offense on code that
  ships.

- a8f4da9: The grammar models platformOS's own tags instead of leaving their markup as raw text.

  `liquid-html-parser` is a Shopify fork, and platformOS is not Shopify: a dozen tags the
  platform registers had no strict rule here, so their markup survived as an unparsed string.
  The parser is TOLERANT, so nothing threw — which is exactly why this was easy to miss. Absence
  of an error is not evidence the grammar understands a construct; `typeof node.markup` is.

  Now modelled, with their arguments and filters: `cache`, `cycle`, `export`, `function`,
  `log`, `redirect_to`, `response_headers`, `response_status`, `spam_protection`, `yield`, and
  the `case`/`when` operands. Filtered expressions are handled where the platform accepts them
  (`liquidFilteredExpression`, `tagArgumentValueWithFilters`), which is what lets
  `FilterWithoutEffect` see a filter that the runtime will parse and then discard.

  **The printer moves with the grammar, and that is the part worth stating.** The Prettier
  plugin REGENERATES source from the AST, so anything the AST does not carry is deleted from
  the author's file on the next format — silently. A construct whose markup is a raw string
  survives formatting today precisely because the printer emits raw strings verbatim; the
  moment it parses, the printer has to know how to print it. Fixtures for the new forms ship
  with this change for that reason, not for completeness.

- f15573d: The parser now publishes the two facts about a write target that consumers were recovering by
  scanning the source, and one shared helper unpicks the three tags that spell a write.

  **`AssignMarkup.targetPosition`** — the span of the target alone (`x`, `x['k']`, `x.a.b`).
  `name` and `lookups` could not reconstruct it: a bracket lookup's node begins INSIDE the
  brackets, so the last lookup's end falls one short of the `]`, and the grammar permits
  whitespace (`x [ 'k' ]` parses) that rules out any fixed offset. The CST always carried
  `target` as a `ConcreteLiquidVariableLookup` and stage 2 dropped it. `hash_assign` and
  `function` already published an equivalent node, so all three write tags are now uniform.

  It is a `Position` rather than a node deliberately: a `Position` has no `type`, so `isNode`
  rejects it and it stays invisible to the visitors and to prettier's `getVisitorKeys`. Adding
  the node would have put a new child on every `{% assign %}` in every project.

  **`LiquidString.unquoted`** — set by, and only by, the `dotLookup` mapping. It is the one signal
  that tells `h.k` from `h['k']` after parsing, since both model the key as a `String`. Previously
  the only difference was that a dot lookup's node was MISSING `single`, in violation of its own
  `boolean` declaration — a type violation that two consumers had independently reasoned about and
  built on, each documenting at length that it could not be trusted. `dotLookup` now sets
  `single: false` as well, so no `String` node carries `undefined` in a `boolean` field.

  A quoted string's node shape is unchanged: `unquoted` is absent rather than `undefined`.

  `InvalidHashAssignTargetSyntax` reads the marker instead of scanning for the last `[` or `.`
  between two lookups; the scan and the marker were measured to agree on every target the grammar
  accepts before it was removed. `InvalidWriteTarget` reads `targetPosition` instead of scanning
  forward for the `]`. The prettier printer still brackets every write target — for `hash_assign`
  a dot in the last lookup is a platform parse error, so that does not depend on the signal — but
  its comment no longer claims the signal does not exist.

  **`write-targets.ts`** is one answer to "what does this tag write, and where is its target",
  replacing six hand-rolled switches over `assign` / `hash_assign` / `function` and their casts.
  It extracts only; the two consumers keep their own rules, because they answer different
  questions — `variable-types.ts` asks what the write DOES to the type table and
  `InvalidWriteTarget` asks whether it is LEGAL, and those trees differ (`x['k'] << v` narrows
  there and is deliberately silent here).

### Patch Changes

- 4567a07: `FilterWithoutEffect` now matches what the runtime actually does with a filter — in both
  directions. Found by running the check over a real project (130 warnings in
  `pos-module-community` alone) and settled by probing a live instance, reading the affected value
  back rather than checking that the page rendered.

  **The discriminator is which Ruby parser receives the value**, not which tag it belongs to:

  | parser                                     | filters | positions                                                              |
  | ------------------------------------------ | ------- | ---------------------------------------------------------------------- |
  | `Liquid::Variable`                         | APPLY   | `{{ }}`, `assign`, `hash_assign`, `session`, `echo`, `print`, `return` |
  | `Liquid::JsonLiteralVariable`              | APPLY   | an argument value that IS a JSON literal                               |
  | `TAG_ATTRIBUTES` scan                      | DISCARD | every other operand and argument value                                 |
  | `Expression.parse` over a `QuotedFragment` | DISCARD | tag operands                                                           |

  Four fixes fall out of that table.

  **`hash_assign` applies its filters** and was missing from the applying allowlist, so every
  `{% hash_assign post['edited_at'] = 'now' | to_time | json %}` was reported as dead code. It is
  `assign`'s deprecated twin and shares its RHS handling, so only the mechanism predicts it — no
  per-tag probe would have.

  ```
  {% assign h = {} %}{% hash_assign h['k'] = 'a' | upcase %}{{ h['k'] }}   -> A
  ```

  **A JSON-literal argument value applies its filters**, so `{% log 'm', data: {"a": 1} | json %}`
  was a false positive — and an increasingly common one now that `parse_json` is deprecated in
  favour of hash literals. Measured with a partial that reads the argument back: it was handed the
  JSON _string_, and `| json | upcase` arrived as `{"A":1}`, both filters in order. The value
  shape decides this, not the tag, which is why it cannot be another allowlist row. A filter
  NESTED inside the literal (`data: {"a": 'z' | upcase}`) is a converter syntax error, so nothing
  there is exempt.

  **A trailing filter is a result filter on `{% graphql res = 'file' %}` and on nothing else.**
  This was a false NEGATIVE — the check was silent on genuinely dead code, which is the direction
  that ships a file doing something other than what its author wrote:

  ```
  {% function r = 'p', a: 1 | dig: 'x' %}      dig is scanned as one more ARGUMENT; r unfiltered
  {% background j = 'p' | dig: 'x' %}          job id comes back unfiltered
  {% graphql g, a: 1 | dig: 'x' %}…            INLINE form drops it
  {% graphql g = 'q', a: 1 | dig: 'x' %}       the ONE that filters the result
  ```

  All four share one grammar rule and one plausible Ruby story, and every "renders clean" probe
  says the same thing about all four — only reading the assigned value back separates them. The
  trailing filter binds to the LAST argument, so it survives exactly when that argument is a JSON
  literal (`{% function r = 'p', items: [1, 2] | reverse %}` really does reverse `items`).

  **`background`'s trailing filter was also a grammar gap**, independent of the above:
  `{% background j = 'p' | upcase %}` did not parse at all — a `LiquidHTMLSyntaxError`, which is
  `error` severity and in `BLOCKING_CHECKS`, so it blocked writes on markup the platform accepts
  and runs. `BackgroundMarkup` now carries `filters` and the printer emits them; without that last
  part the next format would have silently deleted the filter.

  The AST parks a trailing filter on the markup node (`FunctionMarkup.filters` and friends) even
  where the runtime binds it to the last argument. That is a parsing choice that keeps the
  author's text round-trippable, and it must not be read as "this is a result filter" — the check,
  not the AST shape, carries the runtime meaning. The MCP server's instructions previously told
  agents that `function`/`graphql` trailing filters filter the result; that claim is corrected and
  now pinned.

- 4b6e0aa: Add ReservedVariableName check: using a reserved Liquid literal (`true`, `false`, `nil`, `null`, `empty`, `blank`) as a variable name is now an error. Liquid resolves these names as built-in literals before variable lookup, so assignments to them can never be read back. Covers assign, capture, function, graphql, parse_json, hash_assign, for, tablerow, background, increment, decrement, and catch targets. UnusedAssign no longer reports these names to avoid a misleading "assigned but not used" message. The reserved-name set is derived from `LiquidLiteralValues`, now exported from `@platformos/liquid-html-parser`.

## 0.0.17

### Patch Changes

- Improved checks

## 0.0.16

### Patch Changes

- Additional checks and improvements

## 0.0.15

### Patch Changes

- Improved Liquid Linting
  - Better metadata params validation — Reworked detection of undefined variables in page/partial metadata parameters, reducing false positives
  - Improved undefined object detection — More accurate identification of undefined objects in Liquid templates
  - Fixed invalid property detection — The unknown-property check now correctly catches more cases of invalid property access on objects

## 0.0.14

### Patch Changes

- ctrl+click fix

## 0.0.13

### Patch Changes

- better ctrl click, more checks

## 0.0.12

### Patch Changes

- **MissingRenderPartialArguments**: Reports an error when required `@param` arguments declared in a partial's LiquidDoc are not provided at the `{% render %}` call site.
- **NestedGraphQLQuery**: Detects N+1 query patterns — `{% graphql %}` tags inside `{% for %}`/`{% tablerow %}` loops. Also follows `{% function %}` and `{% render %}` calls transitively to detect indirect GraphQL queries. Skips loops wrapped in `{% cache %}` or `{% background %}`.
- Added **GraphQLFieldCompletionProvider**: Provides completions for GraphQL field names.
- Added **GraphQLFieldHoverProvider**: Shows hover documentation for GraphQL fields.
- Added `theme_render_rc` as a new document type, enabling the `{% theme_render_rc %}` tag to resolve partials through configurable `theme_search_paths` defined in `app/config.yml`.
- **DocumentsLocator**: New `locateWithSearchPaths()` method resolves partials using prioritized search paths, including dynamic paths with `{{ }}` Liquid expressions that expand by enumerating subdirectories.
- **loadSearchPaths()**: New utility to read and parse `theme_search_paths` from `app/config.yml`.
- **TranslationKeyExists**: Refactored to load all defined keys (app-level and module-level) in a single pass. Now suggests nearest matching keys using Levenshtein distance when a translation key is not found.
- Extracted shared translation utilities into `translation-utils.ts` for module discovery and key loading.
- Added `levenshtein.ts` utility for fuzzy key matching.
- Added support for `{% try %}...{% catch error %}` — the error variable in catch branches is now correctly registered as defined, preventing false-positive "undefined object" warnings.
- `null`/`nil` literals are now treated as compatible with any `@param` type, preventing false type-mismatch errors when passing null values to partials.
- `recursiveReadDirectory` now gracefully handles `ENOENT` errors instead of crashing when a directory doesn't exist.
- **MissingPartial** check updated to support `theme_render_rc` tag resolution through search paths.
- Extracted `tryExtractAssignUrl()` helper to deduplicate assign-to-URL resolution logic shared between `MissingPage` check and `buildVariableMap`.
- Fixed `buildVariableMap` to correctly recurse into block tags (`{% if %}`, `{% for %}`) whose position spans beyond the cursor offset — previously assigns inside such blocks could be missed.
- **SearchPathsLoader**: Now caches `theme_search_paths` per root URI to avoid re-reading `app/config.yml` on every request. Invalidated when file watchers detect config changes.
- Immediate cache invalidation on `app/config.yml` save (via `onDidSaveTextDocument`) so go-to-definition doesn't see stale data.
- Bulk file-watcher threshold extracted to `BULK_PAGE_CHANGE_THRESHOLD` constant.
- **RouteTable**: Added `routeCount()` method returning total number of route entries.
- Route table build errors are now properly handled — a failed build resets the cached promise so subsequent attempts can retry.
- `MissingPartial` check simplified with a shared `reportIfMissing()` helper, reducing code duplication across `RenderMarkup`, `FunctionMarkup`, and `GraphQLMarkup` visitors.
- AST traversal helpers (`getTraversableChildren`, `getTraversableMarkup`) extracted in `url-helpers.ts`.
- `MissingPage` check front-loads route table building in `onCodePathStart` instead of lazy-loading per element visit.

## 0.0.11

### Patch Changes

- Beta release

## 0.0.10

### Patch Changes

- Beta release

## 0.0.9

### Patch Changes

- Beta release

## 0.0.8

### Patch Changes

- Beta release

## 0.0.7

### Patch Changes

- Update dependencies

## 0.0.6

### Patch Changes

- Beta release

## 0.0.5

### Patch Changes

- Beta release

## 0.0.4

### Patch Changes

- Beta release

## 0.0.3

### Patch Changes

- Beta release

## 0.0.2

### Patch Changes

- Beta release
