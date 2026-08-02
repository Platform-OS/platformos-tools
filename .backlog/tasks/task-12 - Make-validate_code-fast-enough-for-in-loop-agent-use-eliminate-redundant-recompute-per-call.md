---
id: TASK-12
title: >-
  Make validate_code fast enough for in-loop agent use (eliminate redundant
  recompute per call)
status: Done
assignee: []
created_date: '2026-07-29 03:49'
updated_date: '2026-08-03 10:27'
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

## AC #1 is now met — the epic is closed (2026-08-03)

TASK-12.6 was the last structural piece these notes pointed at ("it is now almost entirely
`getApp` re-reading and re-PARSING every project file on every call"). With the lazy `App`
model, the process-shared app, the shared+lazy route table and the anchored walk, warm
`validate_code` through the real MCP stdio bin is:

| project | app files | warm median (10 calls) | cold 1st call |
|---|---|---|---|
| pos-module-community | 947 (1,304 liquid) | **123 ms** (107-168) | 477 ms |
| a large client project | 3,139 (2,735 liquid) | **99 ms** (85-121) | 795 ms |

against the 19-26 s this card opened with, and the ~5.8 s it stalled at after 12.1-12.4.
The goal was "warm steady-state under ~300 ms"; the AC said 500 ms. Both are met with room.

`pos-module-mcp`, the project the AC names, is no longer on this machine. Both stand-ins are
LARGER than it was (it had 1,392 liquid files, 162 after project filtering), so the target is
not being met on an easier project. Full numbers, methodology, live-heap and RSS figures, and
the diagnostics-parity evidence are on TASK-12.6 and TASK-12.6.3.

Live heap is unchanged from these notes' 19.2 MB — 20 MB and 23 MB after 100 calls, flat —
and the transient-AST garbage that put RSS at 404-644 MB is gone rather than cached: 278 MB
and 341 MB peak, flat across 100 calls. AC #2 (identical diagnostics) was re-verified at this
scale: `lintBuffer` against `appCheckRun` filtered to the same URI, 40 files per project, 0
mismatches on every field.

### Children

12.1 GraphQL schema memo · 12.2 partial-analysis memo · 12.3 `CheckOptions.only` · 12.4
process docset · 12.5 the `mode` contract (dropped) · 12.6 the lazy App model (+ its seven
children) — all Done. The follow-up work the migration left open is TASK-46.
<!-- SECTION:NOTES:END -->
