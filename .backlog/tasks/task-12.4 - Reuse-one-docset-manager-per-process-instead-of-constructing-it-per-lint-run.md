---
id: TASK-12.4
title: Reuse one docset manager per process instead of constructing it per lint run
status: Done
assignee: []
created_date: '2026-07-29 03:52'
updated_date: '2026-07-29 04:38'
labels:
  - performance
  - check-node
dependencies: []
modified_files:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/docs-manager-reuse.spec.ts
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`lintApp` in `platformos-check-node/src/index.ts` constructs `new PlatformOSLiquidDocsManager(log)` on every lint run. All of that class's loaders are per-instance `memo`s, including `setup()`, which performs a network request to compare the local docs revision against the remote one. A fresh instance per run therefore means: one network round trip per `validate_code` call (~196 ms measured), plus re-reading and re-parsing filters/objects/tags/SDL from disk.

For a long-lived server process (the MCP supervisor, the language server) the docset is a process-level constant — it does not vary by project or by call. Hoisting it to process scope removes the per-call network hop and makes the GraphQL SDL string stable, which is what lets the schema memo in TASK-12.1 hit.

Care needed: the manager takes a `log` sink, and today each run passes its own. A process-level instance must not permanently capture the first caller's logger in a way that silently drops later runs' diagnostics, and tests that assert docset logging or inject their own docset must keep working. Also confirm behaviour when the network is unavailable — `setup()` already swallows failures, and that must stay true.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repeated lint runs in one process construct the docset manager once and perform at most one revision/network check
- [x] #2 The `log` sink passed by each lint run still receives that run's docset diagnostics (no silent loss, no cross-run leakage)
- [x] #3 Offline / network-failure behaviour is unchanged: a failed revision check degrades to the local or bundled fallback resources without throwing
- [x] #4 Existing consumers that inject their own docset or docs manager (language server, tests) are unaffected
- [x] #5 Covered by a test asserting the manager is constructed once across multiple lint runs
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`lintApp` now takes the docs manager from a module-level `getPlatformOSLiquidDocsManager(log)` instead of constructing one per run. The instance is built once with a FORWARDING sink (`(message) => sharedDocsManagerLog(message)`) and the sink is swapped per run, so each run's docset diagnostics reach its own logger rather than being delivered forever to whichever run happened to be first. Documented caveat: if two runs ever overlap, a late async docset message can land in the newer run's log — a mislabelled diagnostic line, never a lint result.

Offline behaviour is untouched: `setup()` still swallows failures internally and falls back to local/bundled resources; nothing new can throw.

`platformos-language-server-node` already constructed its manager once at startup — the correct pattern — and was left alone. check-node was the only place doing it per run.

Covered by `src/docs-manager-reuse.spec.ts`, which subclasses the real manager through `vi.mock` to count constructions: one construction across two `lintBuffer` calls plus an `appCheckRun`, correct per-run log routing, and lint output still correct through the shared instance. The counter is deliberately not reset between tests, since process-level singleness is the property under test.

Removes the ~190 ms per-call network revision check, and keeping the SDL string stable across runs is what makes TASK-12.1's schema cache hit for a long-lived server.
<!-- SECTION:FINAL_SUMMARY:END -->
