---
id: TASK-8
title: >-
  Restore validate_code's irreducible intelligence (per-domain rules, rule
  library, full result contract) — post-rebuild
status: To Do
assignee: []
created_date: '2026-06-09 15:55'
updated_date: '2026-08-16 12:05'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/ARCHITECTURE.md
  - packages/platformos-check-common/src/checks/index.ts
  - ~/projects/pos/platformos-documentation
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The premise of this epic was WITHDRAWN on 2026-08-16

This epic was created on 2026-06-09 from a review of the v1 `validate_code` contract, and
its goal was stated as: restore what v1 had that the minimal TASK-7 rebuild drops, proven
by comparing against captured v1 baselines. **That goal is no longer the target.** v1 was
wrong in the specific ways TASK-7's revision documents, so "parity with v1" now argues for
reintroducing the defects rather than against them.

What survives is not "v1's intelligence" but a much smaller set of things that are
genuinely good and genuinely unowned. Each child task has been re-scoped to say which.

## What happened to the five gaps this epic listed

| v1 gap | Outcome |
|---|---|
| 1. Per-domain intelligence | **Dissolved** (TASK-8.2). "Domain" is `PlatformOSFileType`, owned by `platformos-common`; gotchas are documentation; the `\| raw` advisory becomes a check-common check. |
| 2. Structured identifiers on the seam | **Deferred pending measurement** (TASK-8.1). `findCurrentNode(ast, offset)` is exported by check-common and resolves the symbol at an offense range without a seam change. |
| 3. The 32-module / 92-rule library | **Dissolved** (TASK-8.3). Hint prose and variants are forbidden by invariant 6; nearest-match belongs in the check as `Offense.suggest`, which 18 checks already do. |
| 4. Full result contract (`tips`, `domain_guide`, `structural`, `parse_error`) | **Each must earn its place** (TASK-8.4). Two are dead with 8.2; the other two need a measurement, not a parity argument. |
| 5. v1-parity safety net | **Cancelled** (TASK-8.5). Comparing to v1 would fail on precisely the fields deliberately removed. |
| (6.) Fix/suggest passthrough | **Superseded** (TASK-8.6) — moved into TASK-7.6 and TASK-7.7, where the same seam was already claimed twice. |

## What is actually left in this epic

Very little, and that is the correct outcome. The supervisor's irreducible value turned
out to be *orchestration* — batching a changeset into one lint pass, the cached project
graph, blast radius, the blocking gate, the response budget — all of which TASK-7 already
ships. The "intelligence" v1 carried was mostly a second copy of things the engine and the
documentation own.

Anything still worth building from here lands in the package that owns the question:
- a detector → a check-common `CheckDefinition` with a documentation page;
- a platform fact → `filters.json` / `tags.json` upstream in `~/projects/pos/platformos-documentation`;
- a cross-file structural answer → `platformos-graph` (the TASK-9 epic).

## Constraints (unchanged, and now stricter)

Every TASK-7 invariant applies to anything done here, including the two amended on
2026-08-16: no LSP protocol on the lint path (pure library reuse is fine), no regex over
diagnostic messages, one graph and one docset, **one detector framework (check-common)**,
pure enrich/result stages, and **the supervisor ships no documentation**.

This remains a tracking epic. Read TASK-7's description for the invariants before starting
any child here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All child tasks are completed or archived with their outcome recorded
- [ ] #2 Nothing added under this epic violates a TASK-7 invariant — in particular, no data/ directory, no second detector framework, and no platform documentation in the supervisor
- [ ] #3 Every capability this epic listed has an owner recorded: a check-common check, an upstream documentation change, a platformos-graph capability, or a stated drop
<!-- AC:END -->
