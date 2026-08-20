---
'@platformos/codemirror-language-client': minor
---

`vscode-languageserver-protocol` is pinned to exactly `3.17.5` instead of `^3.17.5`.

3.18.x ships as exports-only, which breaks every consumer resolving under
`moduleResolution: "node"` — and the range let it in. The failure is easy to miss locally,
where a stale nested `node_modules` copy of 3.17.x satisfies the import and nothing looks
wrong until a clean install.

This is a `dependencies` change, so the pin only protects consumers once it is published.
It had not been: the package is not auto-patched with the rest of the monorepo because its
`@platformos/*` dependencies all sit in `devDependencies`, and the release orchestrator only
inspects `dependencies` when deciding which dependents to bump.

Lands at 0.1.0 rather than 0.0.18, which the 2026-07-21 npm release already occupies.
