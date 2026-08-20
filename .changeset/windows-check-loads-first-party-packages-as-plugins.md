---
'@platformos/platformos-check-node': patch
---

Stop loading the first-party packages as third-party check plugins on Windows.

`findThirdPartyChecks` globs `node_modules` for `platformos-check-*`, which matches the
first-party packages too, so it excludes them by name afterwards. `glob` returns results in the
platform's own separator, so on Windows those names arrived as
`C:\proj\node_modules\@platformos\platformos-check-node` and the exclusion — written with `/` —
matched nothing.

Every run on Windows then `require`d `platformos-check-node`, `-common`, `-browser` and
`-docs-updater` as if they were check plugins. None exports `checks`, so each one printed

```
Error loading C:\proj\node_modules\@platformos\platformos-check-node, ignoring it.
Error: Expected the 'checks' export to be an array and got undefined
```

before being discarded, and `platformos-check-node` was loaded a second time under CJS.

Glob results are now normalized with `toPosixPath` before the exclusion is applied — the same
spelling `globJoin` already used for the patterns going in.
