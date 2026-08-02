---
id: TASK-12
title: >-
  Make validate_code fast enough for in-loop agent use (eliminate redundant
  recompute per call)
status: Done
assignee: []
created_date: '2026-07-29 03:49'
updated_date: '2026-08-01 21:00'
labels:
  - performance
  - supervisor
  - check-common
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`validate_code` currently takes 19–26 s per call on a real module project (`pos-module-mcp`: 1392 liquid + 217 graphql files on disk, 162 after project filtering), and every call costs the same — nothing is reused. Agents call this tool before every write, so at this latency it is unusable in a loop.

The latency is redundant recompute, not necessary analysis. Measured on the npm-installed server (supervisor 0.0.2, check-* 0.0.20) and reproduced against a local build:

- `loadConfig` 36 ms, `glob` 75 ms
- `getApp` (read + parse all project files) 4387 ms
- docset `setup()` (network revision check) 196 ms — a fresh `PlatformOSLiquidDocsManager` is constructed per lint run
- `check()` over all files 21184 ms, then all offenses except the edited file's are discarded
- `check()` over the edited file alone: **93 ms**

Per-check cost over all files (sum 23869 ms, 37 checks): PartialCallArguments 9703 ms, UnknownProperty 4403 ms, GraphQLCheck 3363 ms, NestedGraphQLQuery 912 ms, every other check under 250 ms. The three dominant checks each recompute a pure function they could cache: `buildSchema()` on the 303 KB GraphQL SDL (per graphql file, and per `{% graphql %}` site), and `toLiquidHtmlAST()` of a render target (per call site — ~499 call sites in this project, re-parsing the same partials dozens of times).

Goal: warm steady-state under ~300 ms per call on this project, with byte-identical diagnostics. Fixes land in the shared lint engine (`platformos-check-common` / `-node`), so the CLI and language server benefit too.

Subtasks are ordered by payoff-per-risk: the two memoizations are pure-function caches with no semantic change; the request-scoping change needs an API addition to `check()`; the docset change is per-process lifetime.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Warm steady-state `validate_code` latency on the pos-module-mcp project is under 500 ms per call, measured and recorded
- [x] #2 Diagnostics returned for a given file+buffer are identical before and after the change set (same checks, messages, positions, severities)
- [x] #3 No check is disabled, weakened, or skipped to reach the target
- [x] #4 `yarn test` and `yarn type-check` pass for every touched package
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed on branch `supervisor-check`: TASK-12.1, 12.2, 12.3, 12.4 done; 12.5 (the `mode` contract) raised and its immediate description fix applied.

End-to-end `validate_code` on pos-module-mcp (162-file app, 1392 liquid + 217 graphql on disk), measured over the real MCP stdio bin:

| | before | after |
|---|---|---|
| call 1 | 26.7 s | 6.3 s |
| call 2 | 25.7 s | 5.6 s |
| call 3 | 25.9 s | 5.8 s |

Whole-project `check()` (benefits the CLI and language server too): pos-module-mcp 21284 → 7294 ms, dna-idea 4353 → 1912 ms, poetry-blog 33846 → 11030 ms — byte-identical offenses on all three (captured before/after dumps, diffed).

Correctness evidence, not just unit tests: `lintBuffer` compared against `appCheckRun`'s whole-project offenses filtered to the same uri — dna-idea all 87 files, pos-module-mcp 25, poetry-blog 25 (101 offending files among them) — 0 mismatches on every field. Suites: check-common 1055, check-node 102, supervisor 32, language-server-common 474, check-browser 1, graph 35. Monorepo type-check clean.

Memory investigated (RSS looked like it was growing: 492 → 550 → 644 MB across calls). It is NOT a leak: with forced GC, post-GC heapUsed plateaus at ~19.2 MB and RSS at ~404 MB, growing 0.5 MB/call. The high RSS is transient garbage — parsing all 162 files on every call allocates hundreds of MB of ASTs that are immediately discarded — plus V8 not returning freed pages. The two new caches account for ~4 MB of live data.

AC #1 (< 500 ms) is NOT met yet: ~5.8 s remains, and it is now almost entirely `getApp` re-reading and re-PARSING every project file on every call (3.6–5.8 s of the total; `check()` itself is 81 ms). See the follow-up subtask for that; it is the last structural piece.

### AC #1, revisited 2026-08-01 (after 12.6.x, 12.19–12.23)

The latency target is met with a wide margin, but two things about the wording no longer
hold and are worth stating rather than papering over:

- **`pos-module-mcp` is no longer on disk** (nor are poetry-blog / dna-idea). Measured
  instead on the projects that are, all LARGER than the one in the AC: arabbank (3139
  app files, 390 pages), Accala-MP (2789), pos-module-community (946).
- **`validate_code` itself cannot be measured end to end yet** — the supervisor is
  mid-rebuild and its handler is TASK-7.10. What is measured is `lintBuffer`, the seam
  it calls, which is where all of this epic's cost lived.

Warm `lintBuffer`, per call, three runs after the cold one:

| project | file | warm |
|---|---|---|
| arabbank | `partials/async-operation.liquid` | 54-77 ms |
| arabbank | `pages/about-us.liquid` | 63-65 ms |
| arabbank | `theme/simple/contacts/index.liquid` (resolves routes, renders 45 files) | 117-118 ms |
| Accala-MP | `partials/invoices/index_csv.liquid` | 75-86 ms |
| pos-module-community | `partials/testt.liquid` | 47-64 ms |

Against 19–26 s per call at the start of the epic, and 5.6–6.3 s at the note above.
Where a warm ~72 ms call goes on arabbank (phase split, before 12.23): `loadConfig` 4 ms,
`getApp` walk + reconcile 35-39 ms, route-table sweep 8.5-12 ms, `check()` the rest.
The walk is now the single largest item and is not cached on purpose — see TASK-12.29 for
the remaining ~25% of it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`validate_code`'s seam went from 19-26 s per call to 41-63 ms warm, with byte-identical
diagnostics at every step. All 17 subtasks are Done and all four acceptance criteria
hold.

Warm `lintBuffer`, per call, after the cold one (2026-08-01, all four checks of AC #2
done by diffing whole-project offenses file by file):

| project | file | warm |
|---|---|---|
| arabbank (3139 app files) | `partials/async-operation.liquid` | 47-62 ms |
| arabbank | `pages/about-us.liquid` (5 offenses) | 51-58 ms |
| Accala-MP (2789) | `partials/invoices/index_csv.liquid` | 62-63 ms |
| pos-module-community (946) | `partials/testt.liquid` | 41-50 ms |

Where the time went, in order of what it bought:

- pure-function caches (GraphQL schema, partial parameter analysis) — 12.1, 12.2;
- lint only the file that was asked about, project still visible — 12.3;
- one docset manager and one route table per process, both reconciled not rebuilt —
  12.4, 12.6.7, 12.23;
- a LAZY `App` model in `platformos-common` that reads and parses a file only when a
  check reaches it — 12.6.1/12.6.3, with the language server's getter-forcing spreads
  removed so laziness survives composition (12.6.4);
- an ANCHORED project walk — `APP_SOURCE_SUBTREES`, never a directory-name blacklist
  — shared by the lint, the graph and the LSP, replacing both a whole-tree walk and a
  glob (12.22, 12.25, 12.29);
- one compiled ignore matcher per config instead of one per path per check (12.26);
- one source of truth for name ⇄ path and for what a platformOS file IS (12.21,
  12.27, 1.1).

Correctness the epic FOUND rather than caused, all fixed here: an entire live site
section invisible to the graph and the LSP (`app/views/pages/vendor/**`, 137 files on
one project — 12.25); assets resolved against a root-level `assets/` the platform
never deploys from (12.20); YAML buffers never reaching the language server from VS
Code (12.28); and `lintBuffer` answering "no problems" for three kinds of file it had
not looked at (12.24).

Two things are deliberately unfinished, both recorded where they belong:

- TASK-12.6.4 and TASK-12.6.5 (children of the Done TASK-12.6) are PARTIALLY done.
  Everything the epic needed from them is in; the remainder — `DocumentManager`
  holding an `App`, and deleting the graph's `toSourceCode` wrapper — is blocked on
  an LSP latency harness that does not exist and on the graph-into-check-node wiring
  respectively, with the reasoning written into each task.
- TASK-29: `OrphanedPartial` reports nothing anywhere. Found while deciding
  TASK-12.5's `mode` contract. It reads `context.getReferences`, which check-node has
  never supplied, so the check has been silent in `pos-cli check` all along — not a
  regression from this work, but this work is what surfaced it, and `lintBuffer` now
  accepts the provider that will make it fire.

### Addendum, 2026-08-01: `OrphanedPartial` and `singleFileOnly` were removed

Two bullets above describe a check partition that no longer exists. Wiring the
reverse index it needed (TASK-29) is what produced the evidence to delete it:
350-465 warnings per real project, all 231 of pos-module-community's being a module's
`public/` API, and a large share of the rest partials invoked by name through
dispatchers and callbacks that no static index can see.

So `OrphanedPartial`, `CheckOptions.singleFileOnly`, `meta.singleFile` and
`Dependencies.getReferences` are gone, and `validate_code`'s `mode` is a reserved
no-op again (TASK-12.5, TASK-12.6.8). None of it changes this epic's result — the
latency work stands, and the editor, `pos-cli check` and `validate_code` now run one
and the same set of checks, which is a simpler contract than the epic started with.
<!-- SECTION:FINAL_SUMMARY:END -->
