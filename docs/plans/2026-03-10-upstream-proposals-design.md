# Design: Upstream Proposals — pos-cli check and LSP features

**Date:** 2026-03-10
**Source:** UPSTREAM-PROPOSALS.md
**Approach:** Sequential, priority order — each item independently releasable

---

## Overview

Seven features across two packages:

- `platformos-check-common` — items #4, #1, #2, #3 (new checks + check modification)
- `platformos-language-server-common` — items #8, #7, #6 (LSP features)

**New dependency:** `graphql-language-service` added to `platformos-language-server-common` (items #7 and #6).

**No breaking changes.** All new checks are `recommended: true`. LSP features are additive.

**Shared utilities** introduced in #4, reused by #3:
- `flattenTranslationKeys(obj, prefix)` — recursive YAML object → dotted key list
- `levenshtein(a, b)` — standard O(nm) DP string distance

Both extracted to `packages/platformos-check-common/src/utils/levenshtein.ts`.

---

## #4 — TranslationKeyExists nearest-key suggestion

**Files changed:**
- `packages/platformos-check-common/src/checks/translation-key-exists/index.ts`
- `packages/platformos-check-common/src/utils/levenshtein.ts` (new)

### Design

The existing `onCodePathEnd` already determines a key is missing. Two steps are added after that determination:

1. Load all defined keys via `translationProvider.loadAllTranslationsForBase()` — called once per `onCodePathEnd`, result cached locally so it is not re-read per missing key.
2. Flatten the nested YAML object into `string[]` of dotted keys. Run Levenshtein against each. Return top 3 within distance ≤ 3.
3. Attach as `suggest[]` entries on the existing `context.report()` call. Each suggestion includes a `fix` that replaces the string literal's full position (including quotes) with `'${nearestKey}'`.

### Edge cases

- **Module keys** (`modules/foo/some.key`): nearest-key search covers only the non-module translation space. Module keys get no suggestions.
- **No close match**: if `findNearestKeys` returns empty, offense is reported exactly as today.
- **Performance**: `loadAllTranslationsForBase` is called once per file's `onCodePathEnd`, not per missing key.

### Tests

- Typo key → suggest entries with correct nearest key and a fix that rewrites the literal.

---

## #1 — NestedGraphQLQuery (new check)

**Files changed:**
- `packages/platformos-check-common/src/checks/nested-graphql-query/index.ts` (new)
- `packages/platformos-check-common/src/checks/nested-graphql-query/index.spec.ts` (new)
- `packages/platformos-check-common/src/checks/index.ts` (register)

**Severity:** WARNING (INFO when inside `{% cache %}`)

### Design

Entry visitor on `LiquidTag` maintains a `loopStack: string[]` tracking open `for`/`tablerow` tags by name. When a `graphql` tag is encountered with `loopStack.length > 0`, an offense is reported. If any ancestor node has `name === 'cache'`, severity is downgraded to INFO.

```
LiquidTag (entry)  → if for/tablerow: push name to loopStack
                   → if graphql AND loopStack.length > 0:
                       check ancestors for cache → report WARNING or INFO
LiquidTag:exit     → if for/tablerow: pop from loopStack
```

Result variable name extracted from `node.markup.name` when `markup.type === NodeTypes.GraphQLMarkup`, otherwise omitted from the message.

**Offense message:**
```
N+1 pattern: {% graphql result = '...' %} is inside a {% for %} loop.
This executes one database request per iteration.
Move the query before the loop and pass data as a variable.
```

### Edge cases

- **Nested loops**: `loopStack.length > 1` still triggers — same message.
- **`background` tag inside loop**: not detected — async execution is acceptable.
- **Inline graphql**: detected — `GraphQLInlineMarkup` type, result var omitted from message.

### Tests

- `{% graphql %}` outside loop → no offense
- `{% graphql %}` inside `{% for %}` → WARNING
- `{% graphql %}` inside `{% tablerow %}` → WARNING
- `{% graphql %}` inside nested `{% for %}{% for %}` → WARNING
- `{% graphql %}` inside `{% for %}` inside `{% cache %}` → INFO
- `{% background %}` inside `{% for %}` → no offense

---

## #8 — Circular render detection (LSP diagnostic)

**Files changed:**
- `packages/platformos-language-server-common/src/server/AppGraphManager.ts`

### Design

After every graph rebuild in `processQueue`, a new private `detectAndPublishCycles(rootUri)` method runs DFS cycle detection over the dependency graph. Detected cycles are published via `connection.sendDiagnostics` as ERROR-severity diagnostics on the `{% render %}` tag that closes the cycle. Diagnostics are cleared (empty array) when no cycles are found.

**Algorithm:** Standard DFS with two sets — `visited` (fully processed) and `inStack` (current path, `Set<string>` for O(1) lookup):

```
dfs(node, visited, inStack, path):
  if node in inStack → cycle found: extract path from cycle-start to current
  if node in visited → return
  add to visited + inStack + path
  recurse on each dependency
  remove from inStack + path
```

The closing edge of each cycle maps to an `AugmentedReference` via `getDependencies()`, which carries `source.range` — the character range of the offending `{% render %}` tag.

**Diagnostic format:**
```
Circular render detected: partials/hero → atoms/icon → partials/hero
This will cause an infinite loop at runtime.
```

Source: `'platformos-check'`. Diagnostics cleared on clean rebuild.

### Edge cases

- **Self-render** (`{% render 'foo' %}` in `foo.liquid`): caught as 1-node cycle.
- **Multiple cycles**: all reported independently.
- **Cycle resolved on save**: graph rebuilds clean, previous diagnostics cleared.
- **URI not in graph**: skipped in DFS.

### Tests

- No cycle → no diagnostics published
- A → B → A → diagnostic on render tag in B referencing A
- Self-render → diagnostic on the tag

---

## #2 — MissingRenderPartialArguments (new check)

**Files changed:**
- `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.ts` (new)
- `packages/platformos-check-common/src/checks/missing-render-partial-arguments/index.spec.ts` (new)
- `packages/platformos-check-common/src/checks/index.ts` (register)

**Severity:** ERROR

### Design

`reportMissingArguments()` and `getLiquidDocParams()` already exist in `src/liquid-doc/arguments.ts` and are fully implemented including suggest entries that add the missing argument with a default value. This check wires them up.

On `RenderMarkup`, resolves the partial's LiquidDoc via `getLiquidDocParams()`. If the partial declares params, filters for those with `required: true` not present in `node.args`. Passes the result to `reportMissingArguments()`.

```ts
async RenderMarkup(node) {
  const partialName = getPartialName(node);
  if (!partialName) return;

  const liquidDocParameters = await getLiquidDocParams(context, partialName);
  if (!liquidDocParameters) return;  // no LiquidDoc → skip

  const providedNames = new Set(node.args.map(a => a.name));
  const missingRequired = [...liquidDocParameters.values()]
    .filter(p => p.required && !providedNames.has(p.name));

  reportMissingArguments(context, node, missingRequired, partialName);
}
```

`required` is a first-class field on `LiquidDocParameter` — no heuristic parsing.

### Interaction with existing checks

| Check | Concern | Severity |
|---|---|---|
| `UnrecognizedRenderPartialArguments` | Unknown args passed | WARNING |
| `ValidRenderPartialArgumentTypes` | Type mismatches | WARNING |
| `MissingRenderPartialArguments` | Required args omitted | ERROR |

All three use the same `getLiquidDocParams()` / `getPartialName()` infrastructure.

### Tests

- Partial with no LiquidDoc → no offense
- Partial with all optional `@param` → no offense
- Partial with one required `@param`, caller provides it → no offense
- Partial with one required `@param`, caller omits it → ERROR with suggest to add it
- Partial with multiple required params, all missing → one ERROR per param
- Dynamic partial (`{% render variable %}`) → no offense

---

## #3 — UnusedTranslationKey (new check)

**Files changed:**
- `packages/platformos-check-common/src/checks/unused-translation-key/index.ts` (new)
- `packages/platformos-check-common/src/checks/unused-translation-key/index.spec.ts` (new)
- `packages/platformos-check-common/src/checks/index.ts` (register)

**Severity:** INFO

### Design

`create()` is called once per check run. The `usedKeys` Set in the closure persists across all files visited. `LiquidVariable` accumulates string literal `| t` / `| translate` keys across every liquid file. Dynamic `| t` usage (non-string expression) is silently skipped.

`onCodePathEnd` fires once per liquid file. A `reported` boolean guard ensures the YAML scan and reporting runs exactly once — on the first invocation after all liquid files are processed.

```ts
create(context) {
  const usedKeys = new Set<string>();
  let reported = false;

  return {
    async LiquidVariable(node) {
      if (node.expression.type !== 'String') return;
      if (!node.filters.some(f => f.name === 't' || f.name === 'translate')) return;
      usedKeys.add(node.expression.value);
    },

    async onCodePathEnd() {
      if (reported) return;
      reported = true;

      const rootUri = URI.parse(context.config.rootUri);
      const provider = new TranslationProvider(context.fs);
      const allTranslations = await provider.loadAllTranslationsForBase(
        Utils.joinPath(rootUri, 'app/translations'), 'en'
      );
      const definedKeys = flattenTranslationKeys(allTranslations);

      for (const key of definedKeys) {
        if (!usedKeys.has(key)) {
          context.report({
            message: `Translation key '${key}' is defined but never used in any template.`,
            uri: /* YAML file URI */,
            startIndex: 0,
            endIndex: 0,
          });
        }
      }
    },
  };
}
```

Offenses are reported against the YAML file URI using character offset 0 (line-level precision is not available without a full YAML position tracker — acceptable for INFO severity).

### Caveats

- **Module translations**: not scanned, not reported.
- **Non-`en` locales**: only `en` is checked.
- **Dynamic keys**: silently skipped — may produce false positives on keys used only via dynamic lookup.

### Reused utilities

`flattenTranslationKeys` from `src/utils/levenshtein.ts` (introduced in #4).

### Tests

- Key defined in `en.yml`, used in a template → no offense
- Key defined in `en.yml`, not used anywhere → INFO offense
- Key used with `{{ var | t }}` → no offense (dynamic, silently skipped)
- Key used in one file, defined in another → no offense (accumulation works across files)

---

## #7 — GraphQL field listing in hover and completions

**New dependency:** `graphql-language-service` in `packages/platformos-language-server-common/package.json`

**Files changed:**
- `packages/platformos-language-server-common/src/hover/providers/GraphQLFieldHoverProvider.ts` (new)
- `packages/platformos-language-server-common/src/completions/providers/GraphQLFieldCompletionProvider.ts` (new)
- `packages/platformos-language-server-common/src/hover/providers/index.ts` (register)
- `packages/platformos-language-server-common/src/completions/providers/index.ts` (register)

### Design

Both providers activate on `.graphql` files only (check `uri.endsWith('.graphql')`).

**Schema access:** `context.platformosDocset.graphQL()` returns the schema string. Both providers call `buildSchema(schemaString)` and cache the result per request.

**Hover provider:** Calls `getHoverInformation(schema, query, cursor)` from `graphql-language-service`. Returns a standard `Hover` LSP response with the markdown string.

**Completion provider:** Calls `getAutocompleteSuggestions(schema, query, cursor)` from `graphql-language-service`. Returns `CompletionItem[]`. The library handles context-awareness: inside a selection set it suggests fields, at the operation level it suggests operation types.

**Error handling:** If `platformosDocset.graphQL()` returns `undefined` or `buildSchema()` throws, providers return `null`/`[]` silently — no uncaught errors.

### Tests

Using `HoverAssertion` and `CompletionItemsAssertion` test utilities:
- Hover on field name in `.graphql` file → field type description
- Hover on type name → type description with fields
- Completion inside `{ }` selection set → field names returned
- No schema available → no results, no error thrown

---

## #6 — GraphQL result shape in hover

**Files changed:**
- `packages/platformos-language-server-common/src/hover/providers/GraphQLResultHoverProvider.ts` (new)
- `packages/platformos-language-server-common/src/hover/providers/index.ts` (register)

### Design

Activates on `.liquid` files only. On hover, walks the document AST to find all `LiquidTag` nodes with `name === 'graphql'`. Builds a map of `resultVarName → queryPath`. If the hovered token matches a result variable name, the provider activates.

**Query file resolution:** `DocumentsLocator.locate(rootUri, 'graphql', queryPath)` — same mechanism as `MissingPartial`.

**Shape extraction from the query:**
1. Parse the `.graphql` file with `parse()` from the `graphql` package.
2. Extract the root selection field name (e.g. `records` from `query { records { ... } }`).
3. Find the `results` subfield inside the root field's selection set.
4. Collect the field names selected inside `results { ... }` — read directly from the query's selection set, no schema traversal.

**Hover output:**
```markdown
**`g`** ← `records/users`

**Access pattern:**
- `g.records.results` — array of results
- `g.records.total_entries` — total count
- `g.records.total_pages` — page count

**Selected fields on each result:**
`id` · `created_at` · `email` · `properties`
```

If no `results` subfield exists in the query, the field listing section is omitted.

**Error handling:**
- Query file not found → `null` (let `MissingPartial` handle)
- Query parse error → `null`
- Inline graphql (no file reference) → `null`

### Tests

- Hover on result variable → formatted markdown with access pattern and fields
- Hover on non-result variable → `null`, next provider handles it
- Query file missing → `null`, no error thrown
- Query with no `results` subfield → access pattern shown, no field listing
