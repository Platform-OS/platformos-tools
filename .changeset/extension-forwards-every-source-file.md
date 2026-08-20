---
'platformos-check-vscode': minor
---

The extension forwards every platformOS source file to the language server, and highlights
platformOS's own tags.

**YAML got no language server at all.** `documentSelectors` had no `yaml` entry, so VS Code
never forwarded a translation, table, user-profile-type or transactable-type buffer — no
diagnostics, no completions, no go-to-definition on any of them, however much the lint had to
say. The selectors are now derived from `SOURCE_FILE_EXTENSIONS` in
`@platformos/platformos-common`, so WHICH extensions are platformOS sources stays one answer
rather than two that must agree; only the extension-to-language-id mapping (both YAML
spellings are the `yaml` language) is decided here.

YAML selectors are anchored to the first segment of the app subtrees, because `.yml` is an
extension VS Code also sees on masses of files that are not platformOS sources — opening
`.github/workflows/ci.yml` or a `docker-compose.yml` no longer hands it to the language server
to parse. Liquid and GraphQL need no such anchor: a `.liquid` file is a platformOS file
wherever it sits, and narrowing it would take diagnostics away from anyone working outside a
recognised subtree.

The `json`/`jsonc` selectors are gone. platformOS serves JSON from `.json.liquid`, so a `.json`
file is an asset rather than a source — and nothing could have been served through them anyway,
since `JSONLanguageService` needs `jsonValidationSet.schemas()` and the platformOS docset
returns `[]` for it. The `{config,locales,sections,templates}` paths they matched are Shopify's,
not this platform's.

**Syntax highlighting covers the platformOS tag inventory**, sourced from the parser's grammar
so the two cannot drift: `graphql`, `parse_json`, `background`, `try`/`rc`, `function`, `export`,
`cache`, `redirect_to`, `response_headers`, `response_status`, `spam_protection`, `yield` and
the rest, plus the reserved literals (`empty`, `blank`, `nil`, `null`, `true`, `false`). Shopify's
`sections` and `paginate` cases are removed. A tag the parser accepts but the inventory omits
still highlights — just with the generic `entity.name.tag.liquid` scope rather than a
`keyword.control` one.
