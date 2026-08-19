---
'@platformos/platformos-check-docs-updater': minor
'@platformos/platformos-check-node': patch
'@platformos/platformos-mcp-supervisor': patch
---

A stalled documentation host could hang a lint indefinitely.

`PlatformOSLiquidDocsManager.setup()` compares the local docs revision against the published one, and
it runs on the first lint of every process. That request had no timeout:

```
lintBuffers -> setup() -> remoteRevision() -> download() -> await fetch(path)
```

A host that accepts the connection and never answers holds the caller for as long as it holds the
socket — so `pos-cli check`, the language server and the MCP supervisor could all hang on a network
condition, with no diagnostic and nothing to retry.

It surfaced as a CI failure: `Integration: lintBuffers > materialises fixes while the app is still
live` timing out at 5000 ms. Reproduced exactly by stalling that one URL and nothing else, and cured
by bounding it — the same test then passes while the host is still stalled, because `setup()` already
treats a failed refresh as staleness rather than breakage and keeps the docset on disk.

**One bound for every request, chosen from measurement rather than from the shape of the data.** The
first version of this change had two — a tight bound for the revision check and a generous one for
bulk downloads, on the assumption that a large file needs longer. Measured against the live host, the
largest resource (the 363 KB GraphQL schema) fetches in ~230 ms and the tiny revision check in
~450 ms: latency dominates, size does not, and the second constant was justifying itself with a
guess. So there is one `DOWNLOAD_TIMEOUT_MS`, generous against ~450 ms and under the budget a caller
gives a single lint.

Not a per-platform workaround: the request is bounded everywhere, for every consumer. The CI job that
failed was ubuntu/node24, but the tests matrix has no `fail-fast: false`, so the other three jobs were
cancelled rather than passing — the failure depends on whether a runner's request stalls, which any of
them can hit.

What this does NOT fix is that a lint reaches the network at all. The docset ships with the package and
is refreshed at build time by `postbuild`, so for a one-shot lint the revision check is redundant; the
refresh exists for a long-running language server, which is what `DOCS_MANAGER_MAX_AGE_MS` is for. With
`fileParallelism: false` and `isolate: true` every spec file forks fresh and pays its own request, so
the suite depends on a third-party host being reachable. Deciding who should refresh needs a seam the
manager does not have today — it takes only a `Logger` — and is filed rather than patched around here.
