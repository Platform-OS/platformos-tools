---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': patch
---

Move frontmatter block extraction into `platformos-common`, beside the schemas it validates against

`FrontmatterBlock`, `extractFrontmatterBlock`, `frontmatterBlock` and `wellFormedFrontmatterBlock`
now live in `@platformos/platformos-common`, so a package can read a frontmatter block without
depending on the linting engine. `platformos-check-common` re-exports them and behaves exactly as
before — the frontmatter check suites pass with no edit at all, which is the proof.

The per-file parse is now memoized through `AppFile.derived()` rather than a module-level
`WeakMap` keyed on file identity and source. That is the mechanism the file object already
provides, dropped by the same two places that drop the source, so the linter, the language server
and the graph share one parse instead of keeping private caches.

`platformos-common` gains a dependency on `yaml`. `js-yaml` cannot report the per-node offsets a
frontmatter diagnostic needs to point at the key or value it is about. Both libraries are now
present, and `yaml-load-options.ts` records which is used for what.
