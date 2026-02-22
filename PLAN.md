# Migration Plan: Shopify → platformOS Cleanup

## Context

This plan addresses all issues found during review of the Shopify→platformOS refactor PR.
Issues are grouped by theme, ordered by priority. A Shopify feature is kept only when it maps
cleanly to a real platformOS equivalent. It is deleted when there is no valid platformOS mapping.

### platformOS Partial Paths (canonical reference)

Partials live in ALL of the following locations. `isPartial()` in `platformos-common` covers them:

```
app/lib/
app/views/partials/
modules/<name>/public/lib/
modules/<name>/public/views/partials/
modules/<name>/private/lib/
modules/<name>/private/views/partials/
app/modules/<name>/public/lib/
app/modules/<name>/public/views/partials/
app/modules/<name>/private/lib/
app/modules/<name>/private/views/partials/
```

`DocumentsLocator` in `platformos-common` already handles all these search paths.
**Any code that assumes partials are only under `app/views/partials/` or `app/lib/` is a bug.**

### platformOS Global Object

There is **one** global object in platformOS Liquid: `context`.
Documented at: https://documentation.platformos.com/api-reference/liquid/platformos-objects.md
All test fixtures, completions, and type-inference tests must use `context` (and its nested
properties) rather than Shopify globals (`product`, `all_products`, `section`, `block`, etc.).

### `content_for` in platformOS

`content_for` in platformOS works exactly like Rails `content_for` — it is a named content
capture mechanism. A page defines a region:
```liquid
{% content_for 'sidebar' %}...{% endcontent_for %}
```
And the layout renders it:
```liquid
{% yield 'sidebar' %}
```
There are **no** `type:`, `id:`, or `closest.*` keyword arguments. There is no reference to
any partial or block file. All Shopify-specific argument validation (`type`, `id`, `closest`)
and all block-file resolution must be deleted.

### pos-cli compatibility

`pos-cli` (`/home/mkk/projects/js/pos-cli/lib/check.js`) imports from
`@platformos/platformos-check-node` and calls `themeCheckRun(...)` by name.
When renaming that export, **add a deprecated alias** so pos-cli does not break:
```typescript
export { runCheck as themeCheckRun }; // deprecated: use runCheck
```
Then file a follow-up task to update pos-cli separately.

---

## Group 1 — CRITICAL: Broken Behaviour

### 1.1 Remove `deadCode()` from AppGraphManager

**File:** `packages/platformos-language-server-common/src/server/AppGraphManager.ts`

**Problem:** The current directory list (`blocks/`, `sections/`, `snippets/`, `templates/`,
`layout/`) is entirely Shopify-specific. But more fundamentally, dead code detection does not
map cleanly to platformOS:
- **Pages** (`app/views/pages/`) are entry-point controllers in an MVC model — they define
  HTTP endpoints. They are never "dead" because they serve requests directly.
- **Module partials** are designed to be referenced by external applications that depend on
  the module; they may appear unreferenced within the module itself.
- Dynamic Liquid (`render variable`) and cross-module dependencies make static dead code
  analysis unreliable.

**Fix:** **Remove the `deadCode()` feature entirely.**

1. Delete the `deadCode()` method from `AppGraphManager`
2. Remove `AppGraphDeadCodeRequest` from `types.ts` (namespace + wire method string)
3. Remove the dead code handler in `startServer.ts`
4. Remove the `platformos.graph.hasDeadCode` context key and the corresponding command +
   UI contribution in the VS Code extension (`commands.ts`, `ReferencesProvider.ts`)
5. Update `vscode-extension/src/common/ReferencesProvider.ts`:
   - Remove `'preset'` from `refTypes` (Shopify presets no longer exist)
   - Remove the dead-code tree view section that used `AppGraphDeadCodeRequest`

---

### 1.2 Clear `manifest_platformos.json`

**File:** `packages/platformos-check-docs-updater/data/manifest_platformos.json`

**Problem:** Every entry targets Shopify-specific paths (`blocks/*.liquid`,
`sections/*.liquid`, `config/settings_schema.json`) and Shopify schema URIs.
platformOS does **not** use `locales/*.json` either — there is no locales concept.

**Fix:** Replace with an empty schemas array. There are currently no JSON schema
validation targets in platformOS:

```json
{
  "$schema": "manifest_schema.json",
  "$comment": "JSON schema declarations for platformOS apps. Currently empty — platformOS does not use JSON config files that require schema validation.",
  "schemas": []
}
```

If a JSON schema for platformOS translations (`.yml` in `app/translations/`) becomes
available in future, add an entry then.

---

### 1.3 `JSONContributions.getContext()` short-circuits on ALL Liquid files

**File:** `packages/platformos-language-server-common/src/json/JSONContributions.ts:129-136`

**Problem:**
```typescript
const schema = await findSchemaNode(doc.ast);
if (!schema) return SKIP_CONTRIBUTION;
```
`findSchemaNode` searches for `{% schema %}` tags. platformOS has no `{% schema %}` tag.
Every Liquid file returns `SKIP_CONTRIBUTION`, silently killing hover and completion for
Liquid documents (including `TranslationPathHoverProvider`).

**Fix:** Remove the `findSchemaNode` guard entirely from `getContext()`. After Groups 2.1
is done (all dead schema providers are removed), the Liquid branch in `getContext()` should
simply return the request context without a schema check.

---

### 1.4 Remove the `context` field concept from configs

**Files:**
- `packages/vscode-extension/src/browser/server.ts:42`
- `packages/codemirror-language-client/playground/src/language-server-worker.ts:33`

**Problem:** Both return `context: 'theme'` inside their `loadConfig` implementation.
In platformOS there is only one context — the concept of a "context type" selector
is Shopify-specific.

**Fix:**
1. Remove the `context` field from both `loadConfig` return objects.
2. Check the `Config` type definition — if it contains a `context` field, remove it.
3. Verify nothing in check or LSP logic branches on `config.context`; if it does, remove
   that branch (there's only one valid context in platformOS).
4. Update error message in `browser/server.ts:38`:
   `'Could not find theme root'` → `'Could not find app root'`.

---

## Group 2 — HIGH: Delete Shopify-Only Dead Code

### 2.1 Delete the Shopify JSON schema provider pipeline

These providers guard on `isSectionOrBlockFile()` / `isSectionFile()` / `findSchemaNode()`,
none of which can ever return true in platformOS. Their spec files were already deleted in
this PR.

**Delete these files entirely:**

| File | Reason |
|------|--------|
| `json/utils.ts` | `isSectionFile`, `isBlockFile`, `isSectionOrBlockFile`, `findSchemaNode` — all dead. The only generic helper `fileMatch()` (4 lines) should be inlined at its one call site. |
| `json/hover/providers/BlockSettingsHoverProvider.ts` | Guards on `isSectionOrBlockFile` — never fires |
| `json/hover/providers/SettingsHoverProvider.ts` | Guards on `isSectionFile` — never fires |
| `json/completions/providers/BlockTypeCompletionProvider.ts` | Guards on `isSectionOrBlockFile` — never fires. Distinct from `ContentForBlockTypeCompletionProvider` (handled in Group 3.1). |
| `json/completions/providers/ReferencedBlockTypeCompletionProvider.ts` | Same |
| `json/completions/providers/BlockSettingsPropertyCompletionProvider.ts` | Same |
| `json/completions/providers/SettingsPropertyCompletionProvider.ts` | Guards on `isSectionFile` — never fires |
| `json/completions/providers/SchemaTranslationCompletionProvider.ts` | Only runs inside `{% schema %}` — never fires |
| `json/hover/providers/SchemaTranslationHoverProvider.ts` | Only runs inside `{% schema %}` — never fires |

**Then cascade-clean `JSONContributions.ts`:**
- Remove all dead providers from `this.hoverProviders` and `this.completionProviders` arrays
- Remove `GetThemeBlockSchema` and `GetThemeBlockNames` type exports (Group 3.1 removes
  the entire block-names feature)
- Remove `getThemeBlockSchema` and `getThemeBlockNames` constructor parameters
- Remove `getDefaultSchemaTranslations` constructor parameter (schema translations do not
  exist in platformOS — no `{% schema %}` tag)

**Cascade-clean `JSONLanguageService.ts`:**
- Remove `GetThemeBlockNames`, `GetThemeBlockSchema`, `GetThemeSettingsSchemaForURI` imports
- Remove those three constructor parameters + `getModeForUri` (stored, never called)
- Remove the corresponding private fields

**After cleanup, `JSONContributions` should only register:**
- `TranslationPathHoverProvider` (hover on `t:` filter calls)
- `SchemaTranslationCompletionProvider` → verify whether this is purely for `{% schema %}`
  or also handles regular translation key completion; keep only if the latter

---

### 2.2 Delete the Shopify settings schema pipeline

**File:** `packages/platformos-language-server-common/src/settings/index.ts`

**Problem:** The entire file models `config/settings_schema.json` (Shopify-only):
`ThemeInfo`, `theme_name`, `theme_author`, `theme_version`, `theme_documentation_url`,
`theme_support_url`, `theme_support_email`, `SettingsCategory`, `InputSetting`, etc.

**Fix:** Delete the file, then remove all consumers:

1. **`TypeSystem.ts`**:
   - Remove import of `GetThemeSettingsSchemaForURI`, `InputSetting`, `isInputSetting`,
     `isSettingsCategory` from `./settings`
   - Remove `getThemeSettingsSchemaForURI` constructor parameter
   - Delete `themeSettingProperties()` method (always returns `[]`)
   - Remove `themeSettingProperties` call in `objectMap()`

2. **`startServer.ts`**:
   - Delete `getThemeSettingsSchemaForURI()` function (lines 232–243)
   - Remove it from `CompletionsProvider` and `HoverProvider` constructor args

3. **`CompletionsProvider.ts`** and **`HoverProvider.ts`**:
   - Remove `getThemeSettingsSchemaForURI` field and its `GetThemeSettingsSchemaForURI` import

---

### 2.3 Remove remaining dead functions from `startServer.ts`

After Groups 2.1 and 2.2, remove:

- `getModeForURI()` (lines 245–247) — hardcodes `return 'theme'`, never called
- `getThemeBlockNames()` (lines 249–261) — reads `blocks/` directory (superseded by Group 3.1 deletion)
- `getThemeBlockSchema()` (lines 263–273) — calls `doc.getSchema()` (always `undefined`)

Additionally rename:
- `themeGraphManager` → `appGraphManager` (lines 113, 175, 591 etc.)
- `shopifyTranslations` → `translations` (lines 187, 192)
- Server `name: 'theme-language-server'` → `'platformos-language-server'` (line 417)
- Remove `'blocks'` from the `category` union type at line 206

---

### 2.4 Clean up `missing-partial/index.ts`

**Problem:** Five unused imports + a schema setting that is declared but never enforced.

1. Remove unused imports: `LiquidTag`, `LiquidTagNamed`, `NamedTags`, `Position`,
   `RelativePath`, `doesFileExist`, `minimatch`
2. Implement the `ignoreMissing` schema setting so it actually works:
   - After resolving a `partialName`, skip reporting if it matches any glob in
     `context.settings.ignoreMissing` using `minimatch`
   - This is a valid platformOS use-case: users may intentionally exclude some partials
     from missing-partial checks (e.g. generated files, optional extensions)
   - The schema entry and `minimatch` import are already present — just wire up the logic

---

### 2.5 Remove `getDefaultSchemaLocale` / `getDefaultSchemaTranslations` plumbing

**Problem:** These two methods in `AugmentedDependencies` / `startServer.ts` exist solely for
Shopify's `{% schema %}` localisation (`locales/*.schema.json`). platformOS has no `{% schema %}`.

1. Remove `getDefaultSchemaLocale` and `getDefaultSchemaTranslations` from the
   `AugmentedDependencies` interface (types.ts)
2. Remove their implementations and wiring in `startServer.ts`
3. Remove their usage in any check that calls `context.getDefaultSchemaTranslations()` —
   verify this is now only `matching-translations` (covered in Group 5.3)

---

## Group 3 — HIGH: Delete content_for Block Argument System

### 3.1 Delete the entire content_for block argument feature

**Background:** platformOS `content_for` is Rails-style content capture — it takes a string
name only. There are no `type:`, `id:`, or `closest.*` keyword arguments. There is no
reference to any partial or block file. The Shopify `content_for "block", type: "blockName"`
system (which references `blocks/<name>.liquid`) does not exist in platformOS.

**Delete these checks entirely:**

| File | Reason |
|------|--------|
| `checks/missing-content-for-arguments/` | Validates presence of `type:`, `id:` args for Shopify block references — not applicable |
| `checks/unrecognized-content-for-arguments/` | Same |
| `checks/valid-content-for-argument-types/` | Same |
| `checks/duplicate-content-for-arguments/` | Detects duplicate `type:`, `id:` style kwargs — these args don't exist in platformOS `content_for` |

**Delete the block type completion provider:**

| File | Reason |
|------|--------|
| `completions/providers/ContentForBlockTypeCompletionProvider.ts` | Completes `type: "blockName"` arg which doesn't exist in platformOS `content_for` |
| `completions/providers/ContentForBlockTypeCompletionProvider.spec.ts` | Spec for above |
| `completions/providers/ContentForParameterCompletionProvider.ts` | Completes `type:`, `id:`, `closest:` parameters — these are Shopify block system args only |
| `completions/providers/ContentForParameterCompletionProvider.spec.ts` | Spec for above |

**Clean up `liquid-doc/arguments.ts`:**
- Remove `getBlockName()` function (only used by the deleted checks)
- Remove the `ContentForMarkup` branch that builds `blocks/${blockName}.liquid` paths
- Remove "static block" error message strings — this is Shopify block terminology

**Clean up `checks/index.ts`:**
- Remove exports for all four deleted content_for checks

**Clean up `CompletionsProvider.ts`:**
- Remove `getThemeBlockNames` field and `GetThemeBlockNames` type import
- Remove `ContentForBlockTypeCompletionProvider` and `ContentForParameterCompletionProvider`
  from the providers list

**Keep:** `ContentForCompletionProvider.ts` — it offers `'block'` and `'blocks'` as
completion values for the `content_for` string argument. Verify with the platformOS team
whether these are valid platformOS keywords. If yes, keep but update descriptions to
reflect Rails-style semantics. If no, simplify to offer no keyword suggestions.

---

## Group 4 — HIGH: Fix Partial Resolution to Use DocumentsLocator

### 4.1 Replace all hardcoded partial paths with DocumentsLocator

The following files hardcode `app/views/partials/` as the only partial location. This is
wrong — it misses `app/lib/`, all module paths, and the `modules/<name>/` variants.

**Affected files:**

| File | Location | Issue |
|------|----------|-------|
| `checks/valid-render-partial-argument-types/index.ts:77` | check-common | `app/views/partials/${partialName}.liquid` |
| `checks/unrecognized-render-partial-arguments/index.ts:65` | check-common | `app/views/partials/${partialName}.liquid` |
| `hover/providers/RenderPartialHoverProvider.ts:27` | language-server | `'app/views/partials'` prefix |
| `hover/providers/RenderPartialParameterHoverProvider.ts:27` | language-server | `'app/views/partials'` prefix |
| `completions/providers/RenderPartialParameterCompletionProvider.ts:40` | language-server | `'app/views/partials'` prefix |

**Fix:** Use `DocumentsLocator` from `@platformos/platformos-common` for all partial lookups.
`DocumentsLocator.locate(rootUri, fs, 'partial', partialName)` already handles all valid paths.

**Extend `platformos-common/src/path-utils.ts`** with a synchronous helper if needed by checks:
```typescript
/**
 * Returns ordered candidate URIs for a partial, covering all platformOS partial locations.
 * App paths are checked before module paths.
 */
export function getPartialCandidateUris(rootUri: string, partialName: string): string[]
```
Export from `platformos-common/src/index.ts`.

For the **language-server hover/completion providers** that build a URI string to look up
a document, use `DocumentsLocator.locate()` (async, uses the actual filesystem) rather
than constructing a path string manually.

---

### 4.2 Update `undefined-object` check for partial path detection

**File:** `packages/platformos-check-common/src/checks/undefined-object/index.ts:212-216`

The `getContextualObjects()` helper currently checks:
```typescript
relativePath.includes('views/partials/') || relativePath.includes('/lib/')
```
This is correct for the matching logic (both conditions are covered by `isPartial` semantics),
but verify it handles module paths (e.g. `modules/my-module/public/views/partials/foo.liquid`).
The regex `/lib/` and `/views/partials` will match module paths correctly since they use
`includes()`. Confirm with a test case.

---

## Group 5 — MEDIUM: Rename for Consistency

### 5.1 Wire protocol strings: `themeGraph/` → `appGraph/`

**File:** `packages/platformos-language-server-common/src/types.ts:88–129`

These are externally observable strings. After Group 1.1 removes `AppGraphDeadCodeRequest`,
update the remaining four:

```typescript
'themeGraph/references'      → 'appGraph/references'
'themeGraph/dependencies'    → 'appGraph/dependencies'
'themeGraph/rootUri'         → 'appGraph/rootUri'
'themeGraph/onDidChangeTree' → 'appGraph/onDidChangeTree'
```

Also update the VS Code extension and CodeMirror client at every place these strings appear.

---

### 5.2 `DocumentManager.theme()` → `app()`

**File:** `packages/platformos-language-server-common/src/documents/DocumentManager.ts:79`

Rename the method and update all call sites:
- `runChecks.ts:55` — `documentManager.theme(...)` → `documentManager.app(...)`
- `startServer.ts:185` — same
- Also: rename local variable `theme` → `app` and `themeOffenses` → `appOffenses` in `runChecks.ts`
- Rename parameter `themeGraphManager` → `appGraphManager` in `runChecks.ts` lines 28, 32
- Remove dead `getModeForUri` constructor parameter from `DocumentManager`

---

### 5.3 `AppCheckRun.theme` → `app` + pos-cli compat alias

**File:** `packages/platformos-check-node/src/index.ts:41`

```typescript
// Before
export type AppCheckRun = { theme: App; config: Config; offenses: Offense[] };

// After
export type AppCheckRun = { app: App; config: Config; offenses: Offense[] };
```

Rename `runThemeCheck` → `runCheck` and add backward-compat alias:
```typescript
export const runCheck = ...; // new name
export const themeCheckRun = runCheck; // deprecated alias for pos-cli
```

Update all destructuring of `{ theme }` → `{ app }` in:
- `cli.ts:8,17`
- `index.ts:63,72,102,111`
- `backfill-docs/index.ts:68`

Remove dead code `const isValidSchema = validator?.isValid` at `index.ts:76`.

**Note:** After publishing, file a task to update `pos-cli/lib/check.js` to call `runCheck`
instead of `themeCheckRun` and remove the alias.

---

### 5.4 `context-utils.ts` parameter names

**File:** `packages/platformos-check-common/src/context-utils.ts`

Rename parameter `theme: App` → `app: App` at lines 56, 88, 107 and update all usages
within those function bodies.

---

### 5.5 CLI command name

**File:** `packages/platformos-check-node/src/cli.ts`
- Rename function `runThemeCheck` → `runCheck`
- Update three usage strings from `theme-check` → `platformos-check` (lines 26, 29, 32, 56)

**File:** `packages/platformos-check-node/src/backfill-docs/index.ts`
- Lines 66, 70: rename variable `theme` → `app`, update inline comments
- Lines 248, 263–265: update help text `theme-check backfill-docs` → `platformos-check backfill-docs`

---

## Group 6 — MEDIUM: Fix Logic Issues

### 6.1 `find-root.ts` — root detection too strict + dead helpers

**File:** `packages/platformos-check-common/src/find-root.ts`

**Problem:**
1. `isRoot` requires ALL of `.pos`, `app/`, `modules/`, `.git` — but `modules/` and
   `.git` are optional. New apps may have only `.pos` + `app/`.
2. The `not()` helper function is defined but never called.
3. The `or()` wraps only one argument — effectively a no-op.
4. JSDoc references `shopify.extension.toml`, `snippets/`, "theme root".

**Fix:**
- Change `isRoot` to: **if `.pos` OR `app/` OR `modules/` exists, it is a platformOS app**.
  Use `or(hasFile('.pos'), hasFile('app'), hasFile('modules'))`.
- Remove the unused `not()` helper
- Remove the `or()` no-op wrapper from the previous single-branch usage
- Update JSDoc: remove `shopify.extension.toml` / `snippets/` references, replace "theme root"
  with "app root", describe `.pos` as the sentinel file

---

### 6.2 `load-third-party-checks.ts` — wrong glob patterns

**File:** `packages/platformos-check-node/src/config/load-third-party-checks.ts`

```typescript
// Before — scans Shopify packages
globJoin(..., '/node_modules/theme-check-*/'),
globJoin(..., '/node_modules/@*/theme-check-*/'),
// exclusion
!/\@shopify\/theme-check-(node|common|browser|docs-updater)/.test(x) &&
!/theme-check-vscode/.test(x)

// After — scans platformOS packages
globJoin(..., '/node_modules/platformos-check-*/'),
globJoin(..., '/node_modules/@*/platformos-check-*/'),
// exclusion
!/\@platformos\/platformos-check-(node|common|browser|docs-updater)/.test(x) &&
!/platformos-check-vscode/.test(x)
```

Update JSDoc example: `'@acme/theme-check-extension'` → `'@acme/platformos-check-extension'`.
Also update `resolve-config.spec.ts` mock package name `@acme/theme-check-base` →
`@acme/platformos-check-base`.

---

### 6.3 Translation checks — remove Shopify locales, update to platformOS paths

**Background:** platformOS translations are `.yml` files in `app/translations/`
(and `modules/<name>/public/views/translations/`, etc. — handled by `TranslationProvider`).
The Shopify `locales/*.json` pattern does not exist in platformOS.

**`matching-translations/index.ts`:**
1. Remove `isShopifyPath` function (line 51) and its two usages (lines 132, 161).
   platformOS translation keys have no `shopify.*` prefix.
2. Remove `isSchemaTranslationFile` variable and the schema translation branch (line 39,
   lines 113–115). Schema translations (`.default.schema.json`) are a Shopify-only concept.
3. Update `relativePath.startsWith('locales/')` (line 36) to use platformOS translation paths.
   platformOS translation files live in `app/translations/` — use `TranslationProvider` from
   `@platformos/platformos-common` to detect and load translation files instead of checking
   `locales/` path manually.

**`valid-html-translation/index.ts`:**
- Update `relativePath.startsWith('locales/')` guard (line 22) to match platformOS translation
  file locations (e.g. `relativePath.includes('/translations/')`).

**`context-utils.ts`:**
- Line 66 reads `fs.readDirectory(join(rootUri, 'locales'))` — replace with a call to
  `TranslationProvider` which already handles all platformOS translation paths including modules.

---

### 6.4 Remove `isSnippet` re-export

**File:** `packages/platformos-check-common/src/path.ts:3`

Remove `isSnippet` from the re-export. Grep for any callers; migrate to `isPartial`.

---

## Group 7 — MEDIUM: Update Tests to Use platformOS Context

### 7.1 `TypeSystem.spec.ts` — replace all Shopify fixture objects

**File:** `packages/platformos-language-server-common/src/TypeSystem.spec.ts`

Replace mock object set with platformOS equivalents. The only global object is `context`.
Build fixtures from its documented structure (https://documentation.platformos.com/api-reference/liquid/platformos-objects.md):

| Remove | Replace with |
|--------|-------------|
| `all_products` (global) | `context` (global, has nested properties) |
| `product` with `featured_image`, `metafields` | `context.current_user` (drop-accessible) |
| `metafield` | A generic nested object (e.g. `context.params`) |
| `predictive_search` | Remove — no platformOS equivalent |
| `recommendations` | Remove — no platformOS equivalent |
| `section` | Remove — no platformOS equivalent |
| `block` | Remove — no platformOS equivalent |
| `app` | Keep only if `app` is a documented platformOS object; otherwise remove |

Preserve test structure (inference of nested props, arrays, unions, global vs. drop access).
All test assertions must pass with the new fixture data.

---

### 7.2 `LiquidObjectHoverProvider.spec.ts` and `ObjectCompletionProvider.spec.ts`

**Files:**
- `packages/platformos-language-server-common/src/hover/providers/LiquidObjectHoverProvider.spec.ts`
- `packages/platformos-language-server-common/src/completions/providers/ObjectCompletionProvider.spec.ts`

Apply the same replacement as 7.1. Suggested minimal fixture set:
```typescript
_objects = [
  // The single platformOS global
  {
    name: 'context',
    access: { global: true, parents: [], template: [] },
    properties: [{ name: 'current_user', return_type: [{ type: 'current_user', array: false }] }]
  },
  // A nested object reachable via context
  {
    name: 'current_user',
    access: { global: false, parents: [{ object: 'context', property: 'current_user' }], template: [] },
    properties: [{ name: 'name' }, { name: 'email' }, { name: 'id' }]
  },
  // A non-global, non-parent object to test filtering
  { name: 'form', access: { global: false, parents: [], template: [] }, properties: [] },
]
```

---

### 7.3 `JSONLanguageService.spec.ts` — remove Shopify section/block schemas

**File:** `packages/platformos-language-server-common/src/json/JSONLanguageService.spec.ts`

- Delete `simplifiedSectionSchema`, `simplifiedTaeBlockSchema`, and all tests that use
  `**/sections/*.liquid` or `**/blocks/*.liquid` file matchers
- Remove `getThemeBlockNames`, `getBlockSchema` from the test setup
- Replace `shopify.dev/...` URIs with something generic (e.g. `test://schema.json`)
- Keep only tests that exercise JSON language features not specific to Shopify schemas
  (e.g. basic JSON hover, basic JSON completion against a generic schema)

---

### 7.4 `json/test/test-helpers.ts` — simplify mock

**File:** `packages/platformos-language-server-common/src/json/test/test-helpers.ts`

- Remove `getThemeBlockNames`, `getBlockSchema`, `blockUri` from `mockJSONLanguageService()`
- Remove `**/{blocks,sections}/*.liquid` file matcher and `shopify.dev/block-schema.json` URI
- The helper should only configure schemas that are relevant in platformOS

---

### 7.5 `runChecks.spec.ts` — stale root URI

**File:** `packages/platformos-language-server-common/src/diagnostics/runChecks.spec.ts`

Line 22: `rootUri: 'browser:///theme'` → `'browser:///app'`.

---

## Group 8 — LOW: Comments, JSDoc, Typos, Minor

### 8.1 Stale JSDoc and code comments

| File | Line(s) | Change |
|------|---------|--------|
| `types/platformos-liquid-docs.ts` | 4 | "Shopify themes docset" → "platformOS Liquid docs" |
| `types/platformos-liquid-docs.ts` | 10–20 | Four method comments: "on themes" → "in platformOS apps" |
| `types/platformos-liquid-docs.ts` | 43 | `fileMatch` example: `sections/` → `app/views/partials/` |
| `types.ts` (language-server) | 39–49 | JSDoc example: replace Shopify workspace (`sections/`, `snippets/`) with platformOS structure |
| `types.ts` (language-server) | 61,69,71 | Replace `Shopify/theme-liquid-docs` and `theme-check` references |
| `disabled-checks/index.ts` | 140 | `{% #theme-check-disable-next-line %}` → `{% #platformos-check-disable-next-line %}` |
| `autofix.ts` (check-common) | 11–12 | "Takes a theme… on the theme" → "Takes an app… on the app" |
| `autofix.ts` (check-node) | 17 | "on a theme" → "on an app" |
| `runChecks.ts` | 42–43 | Comment path `snippets/` → `app/views/partials/` |
| `orphaned-partial/index.ts` | 9 | Description: "in themes" → "in platformOS apps" |
| `parser-blocking-script/index.ts` | 11 | Replace `'They are bad ok?'` with: `'Parser-blocking scripts delay page rendering. Add defer or async attribute.'` |
| `startServer.ts` | 84 | Comment: `theme-check-js` → `platformos-check` |
| `DocumentManager.ts` | 120 | JSDoc: "theme" → "app" |
| `valid-doc-param-types/index.ts` | 25 | "during theme-check" → "during platformos-check" |
| `FilterNamedParameterCompletionProvider.ts` | 95,104,105 | Replace `product \| image_url` example with a generic platformOS-relevant example |

---

### 8.2 Fix typo in `documents/types.ts`

**File:** `packages/platformos-language-server-common/src/documents/types.ts`

`isGraphQLSourceceCode` → `isGraphQLSourceCode` (typo: `Sourcece` → `Source`).

---

### 8.3 Rename `themeLiquidDocsManager.spec.ts`

**File:** `packages/platformos-check-docs-updater/src/themeLiquidDocsManager.spec.ts`

Rename to `platformOSLiquidDocsManager.spec.ts`. Update imports. Also:
- Remove dead mock key `section_schema.json`
- Replace test translation key `shopify.checkout.general.cart` with
  a generic key like `platform.general.hello`

---

### 8.4 Playground demo update

**File:** `packages/codemirror-language-client/playground/src/playground.ts`

Replace the Shopify-themed demo with a platformOS equivalent:
- Remove `{% schema %}...{% endschema %}` block from `exampleTemplate`
- Remove `{{ section.settings.title }}` — replace with platformOS Liquid
  (e.g. `{{ context.current_user.name }}` or `{% render 'partials/header' %}`)
- Replace all `browser:/sections/` → `browser:/app/views/pages/`
- Replace all `browser:/snippets/` → `browser:/app/views/partials/`
- Remove `exampleSchemaTranslations` (section-specific i18n, no platformOS mapping)
- Rename variable `themeTranslationsEditor` → `translationsEditor`

---

### 8.5 `platformOSLiquidDocsDownloader.ts` — Shopify source

**File:** `packages/platformos-check-docs-updater/src/platformOSLiquidDocsDownloader.ts`

- Line 10: `PlatformOSLiquidDocsRootFallback` points to `Shopify/theme-liquid-docs`.
  Add `// TODO: update to platformOS liquid docs repo once available` comment.
- Lines 20, 29: Rename `shopify_system_translations` → `platformos_system_translations`
  (rename both the key and the data file on disk in `data/`).
- Line 30: `manifest_theme.json` remote path → `manifest_platformos.json`.

---

### 8.6 `SchemaObject` / `getSchema` documentation

**File:** `packages/platformos-language-server-common/src/documents/types.ts`

Update the `AugmentedLiquidSourceCode.getSchema` JSDoc to note:
> In platformOS, `getSchema()` always returns `undefined` — there is no `{% schema %}` tag.

The `SchemaObject` interface may remain as a type but should be marked `@deprecated` or
annotated as unused in platformOS.

---

## Implementation Order

```
Group 1  →  Group 2  →  Group 3  →  Group 4
                                       ↓
                         Group 5, 6, 7 (parallel after 4)
                                       ↓
                                    Group 8
```

Run `NPM_TOKEN=dummy yarn build && NPM_TOKEN=dummy yarn test` after each group.
