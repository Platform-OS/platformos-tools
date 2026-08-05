---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': patch
'@platformos/platformos-language-server-common': patch
---

Close the file-identity gaps outside `platformos-common` — five places that still
classified or named platformOS files themselves, each wrong in a way the
directory-name guard could not see:

- **Rename handlers use logical names.** `partialName`/`assetName` were
  `path.basename(uri, '.liquid')`, which flattens nested and module names: renaming
  `views/partials/ui/card.liquid` computed `card`, missed every
  `{% render 'ui/card' %}` call site, and rewrote a top-level `card` partial's
  arguments instead. All three consumers (partial rename, asset rename, `{% doc %}`
  param rename) now resolve through `pathToName`. Asset names now keep their FULL
  filename, `.liquid` included — the backend's `AssetName` strips only the directory
  prefix; the `.liquid`-stripping was Shopify's rule, not platformOS's.

- **The `home` page deprecation is a page-and-name question, not a filename one.**
  `ValidFrontmatter` flagged ANY file named `home.html.liquid` — partials, emails,
  nested pages — and missed `home.liquid`. It now fires exactly when a Page's
  logical name spells the deprecated root alias (`isDeprecatedHomeAlias`, new in
  the route-table next to the slug rule it restates), module pages included,
  `blog/home` and partials excluded.

- **`findRoot` recognizes the legacy root.** The root markers were `.pos`, the
  config file, `app/` and `modules/` — not `marketplace_builder/`, so a legacy
  project without a sentinel resolved no root at all: no diagnostics, no
  completions. The markers now come from `APP_ROOTS` (newly exported), legacy
  included.

- **Every translation lookup covers both roots and both layouts.** `getDefaultTranslations`
  hardcoded `app/translations/en.yml`; a `marketplace_builder/`-rooted project or a
  split-file layout (`translations/en/*.yml`) silently got `{}` as its reference
  translations. It now goes through `TranslationProvider` over
  `getAppPathsAcrossRoots(Translation)` (new), first root with content wins — and
  `TranslationProvider.getSearchPaths` itself now derives from
  `getAppPathsAcrossRoots`/`getModulePaths` instead of hardcoding `app/translations`,
  so `TranslationKeyExists` and translation go-to-definition see a legacy-rooted
  project's translations too. The reference locale is the exported `DEFAULT_LOCALE`
  rather than four scattered `'en'` literals, and the new `uriToName(uri, rootUri)`
  is `pathToName` for callers holding a URI and its root.

- **Nested asset renames reach the handler.** The LSP's file-operation filter was
  `**/assets/*`, and a single `*` does not cross `/`, so renaming
  `app/assets/js/app.js` never fired the rename handling at all. The glob is now
  `ASSET_FILE_OPERATION_GLOB` (`**/assets/**`), derived from `FILE_TYPE_DIRS` in
  `platformos-common`.
