---
id: TASK-8.3
title: >-
  Port the v1 rule library as pure functions over structured diagnostics (hints,
  variants, did-you-mean, confidence, fixes)
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
labels: []
dependencies:
  - TASK-8.1
references:
  - packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md
  - docs/mcp-supervisor/salvage/data/hints
  - packages/platformos-check-common/src/fixes
parent_task_id: TASK-8
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Port v1's rule library — 32 rule modules / 92 rules (`CURRENT_SYSTEM_ARCHITECTURE.md` §5.8) — into the supervisor's PURE `enrich/` stage as functions over `(StructuredDiagnostic, ProjectGraph, Docset, Domain, Knowledge)`. This replaces the placeholder scope in TASK-7.7 ("attach a hint by check code") with the real per-check intelligence.

## Why
This is the bulk of `validate_code`'s "tool for LLM" value: variant hints, did-you-mean suggestions, confidence, see_also, and structured fixes. It is what TASK-7.7 stubs and what makes the difference between a generic linter and the supervisor.

## What to port (and how, cleanly)
- Variant selection from TYPED fields (task-8.1 `data`), NOT regex over `message`. Example: `MissingPartial` -> `invalid_lib_prefix` vs `module` vs `suggest_nearest`, chosen from the structured matched path, not a parsed string.
- did-you-mean via the SHARED graph/docset (`nearestByLevenshtein`, partial/asset/translation-key lookups) — through `platformos-graph` + `AugmentedPlatformOSDocset`, never a bespoke index.
- Static confidence assignment (heuristic/rule-based; the analytics-driven calibration from the legacy system is permanently out of scope per v1 §10).
- `see_also` linking from the knowledge layer (task-7.5 data).
- Hint rendering: select the salvaged `data/hints/<Check>[-variant].md` and substitute `{{var}}` from typed `data`.
- Fix translation done right: an `Offense.fix` is a `Fixer` FUNCTION, not a declarative edit. Obtain concrete edits by running it through a check-common `StringCorrector` + `applyFixToString` (`packages/platformos-check-common/src/fixes`) to get `FixDescription[]`, then map those to the agent-facing `Fix` shape. Do NOT hand-regenerate edits the engine already expresses.

## Constraints
- PURE: no node:fs / process / I/O (task-7.1 purity guard). All project facts arrive via the graph/docset built in lint/ (task-7.6).
- No regex over diagnostic `message` strings anywhere (task-7.1 guard). Everything keys off task-8.1 `data`.
- Reuse the engine's structured `fix`/`suggest`; the supervisor authors no detection and no new correctness fixes (those live in check-common).

## Out of scope
- Domain-specific advisories/gotchas (task-8.2).
- Result envelope assembly (task-8.4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The v1-covered checks get ported per-check enrichment (hint + variant + suggestion + confidence + see_also) implemented as pure functions; unit pins cover representative diagnostics per check
- [ ] #2 Hint variant selection and {{var}} substitution read ONLY task-8.1 typed data — no regex over diagnostic message strings (task-7.1 guard passes)
- [ ] #3 did-you-mean / nearest-match suggestions are computed via the shared platformos-graph + AugmentedPlatformOSDocset, with no bespoke index
- [ ] #4 Agent fixes are produced by executing the Offense Fixer through a StringCorrector to FixDescription[] and mapping to the agent Fix shape, not by regenerating edits
- [ ] #5 Confidence is assigned statically; no analytics/case-base machinery is reintroduced
<!-- AC:END -->
