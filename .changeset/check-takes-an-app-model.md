---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
'@platformos/platformos-check-browser': minor
'@platformos/platformos-language-server-common': minor
'@platformos/platformos-common': minor
---

`check()` takes an `App`, so the language server gets the name index too.

`check-common` declared `App = AppModel | SourceCode[]` and reduced it with
`app: Array.isArray(app) ? undefined : app`. The language server passed
`documentManager.app(rootUri, …)` — an array — so in the editor `dependencies.app`
was ALWAYS `undefined`: every `DocumentsLocator` inside every check fell back to
`stat`-ing candidate paths in order (4 per partial, 16 per module partial), and
`context.fileType` re-derived through `getFileType` what the file had already
classified once. The editor is where that latency is visible to a person, and it was
the one consumer not getting the model the rest of the toolchain was moved onto.

The union is gone. `check()` and `autofix()` take an `AppModel`; `runChecks` passes
`documentManager.appModel(rootUri)` and narrows what is VISITED with
`{ only: <the documents it publishes for> }`, so the set of files that get diagnostics
is unchanged while the checks can now see the whole project.

Measured on three real projects, checking every file the editor can be asked for,
before and after in the same session: 190.1 s → 100.2 s (1.9x, 3139 files),
pos-module-community 48.9 s → 23.3 s (2.1x, 1509 files), and 14.7 s → 12.4 s
(1.2x, 2789 files).

Reported offenses are identical on two of the three. The one difference, on the largest,
is a false positive that disappears: a `{% render 'admin/users/csv/index' %}`
resolves to `app/views/partials/admin/users/csv/index.csv.liquid`, which
the platform renders and the candidate-path walk cannot find — `nameToPaths` generates
only `.liquid` and `.html.liquid` for a partial, while `pathToName` strips the `.csv`
response format, so the index knows the file by the name the tag spells and the walk
does not. The index is right. (That asymmetry between the two functions is a separate
bug in the walk, and it still affects callers that have no `App`.)

Behaviour that changes:

- Cross-file checks in the editor resolve against the whole app rather than only the
  other open tabs. With the default `includeFilesFromDisk: false` that is the
  difference between "a handful of buffers" and "the project", so `MissingPartial` and
  friends stop reporting names that exist on disk but are not open.
- A file that exists only as an unsaved buffer now resolves. That is what makes a
  partial you just created work before you save it.
- The file watcher is ANCHORED. It watched `**/*.liquid`, `**/*.yml`, `**/*.graphql`
  and `**/*.css`, which deliver every generator template, build artifact, seed and
  `node_modules` copy in the repository — each one read before the server found out it
  was not an app file. It now watches `APP_WATCH_GLOBS`, which is `parseAppPath`'s
  grammar as globs, derived from `FILE_TYPE_DIRS`. `app/tmp/x.liquid` is not a partial
  and is no longer reported as a change.
- `DocumentsLocator` no longer answers for ASSETS from the app's index, even when the
  app holds them. Nothing reads an asset, so the only question asked about one is
  whether it exists — and a `stat` cannot go stale, where an index entry can (the
  lint's walk collects no assets, and the watcher deliberately does not cover them).
  The CLI and the editor therefore answer identically.
- One unreadable file no longer costs a whole `check()` run. The read is now caught
  per file, the way the check pipelines already were.

`ValidJSON` and `JSONSyntaxError` are REMOVED. Both are `SourceCodeType.JSON` checks,
and a platformOS app has no JSON source: `sourceCodeTypeOf` has no `.json` row, so no
`.json` file is ever in an `App`. They were unreachable from the CLI on master too —
its project glob was `**/*.{liquid,graphql,yml,yaml}` — and unreachable from the
editor since `DocumentManager` started serving `App.sourceCodes()`. `JSONCorrector`,
`SourceCodeType.JSON` and the JSON language service are untouched; JSON responses come
from `.json.liquid`, which is Liquid and is checked as such.

Breaking, for anyone consuming these packages directly:

- `App` and `appFiles()` are gone from `platformos-check-common`. Import `App` from
  `@platformos/platformos-common` (re-exported as `AppModel`), and use
  `app.sourceCodes()` in place of `appFiles(app)`.
- `SourceCode` no longer carries `load?` / `loadedSource?`. They were optional members
  only one implementation had; read them off an `AppFile`.
- `check()`, `autofix()`, `makeGetDefaultTranslations()`, `makeGetTranslationsForBase()`,
  `collectPartialUsages()` and `AppCheckRun.app` take/return an `App` rather than the
  union.
- `FixApplicator` receives a `FixableSource` (`uri`, `type`, `source`) instead of a
  full `SourceCode`. No applicator ever read the AST.
- `platformos-check-browser`'s `getApp` is gone; `simpleCheck` builds the app itself
  from `config.rootUri` and `dependencies.fs`. Its offense URIs now derive from
  `config.rootUri` instead of a hardcoded `browser:/`, and its paths must be real
  platformOS paths — the same rule the CLI and the editor apply.
