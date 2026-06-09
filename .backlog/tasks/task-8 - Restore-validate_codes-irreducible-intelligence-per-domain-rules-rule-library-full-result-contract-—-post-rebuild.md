---
id: TASK-8
title: >-
  Restore validate_code's irreducible intelligence (per-domain rules, rule
  library, full result contract) — post-rebuild
status: To Do
assignee: []
created_date: '2026-06-09 15:55'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md
  - packages/platformos-mcp-supervisor/LEGACY_SYSTEM_ARCHITECTURE.md
  - docs/mcp-supervisor/salvage
  - packages/platformos-check-common/src/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context (read before starting any child)

TASK-7 rebuilds `platformos-mcp-supervisor` from scratch as a THIN, MINIMAL agent-ergonomics layer over a structured `Offense` contract, shipping ONLY the `validate_code` tool. That rebuild deliberately stops at a clean minimal `validate_code`: lint via check-node `check()` -> structured diagnostics -> basic enrichment + result assembly. It does NOT port the supervisor's domain-aware intelligence.

This epic restores the supervisor's OWN irreducible logic — the part `platformos-check-common` does not and will not have — on top of the clean TASK-7 foundation, WITHOUT regressing any TASK-7 architectural invariant (no in-process LSP for lint; no regex over diagnostic message strings; one graph; one docset; pure enrich/result stages; check-common is the single source of truth for correctness).

This epic was created from a review (2026-06-09) of the v1 `validate_code` contract (`CURRENT_SYSTEM_ARCHITECTURE.md`, the compiled `dist/`, and the 13 captured parity baselines) against the TASK-7 plan. It records the gaps that, if left unaddressed, would shrink `validate_code`'s LLM-facing output versus v1.

## What v1 had that the minimal TASK-7 rebuild drops (the work here)

1. PER-DOMAIN INTELLIGENCE — entirely supervisor-owned; check-common has NO domain concept (verified). Covers: domain detection from path (pages/partials/layouts/commands/queries/graphql/schema/translations), triggered gotchas (`always` / `has_check:X` / `uses_tag:X`), domain-scoped content-trigger `tips` (incl. the `| raw` XSS advisory), the domain-aware scorecard, and the `domain_guide` result field. See child 8.2.

2. STRUCTURED IDENTIFIERS ON THE SEAM — `Offense` (check-common `types.ts`) carries only `{ type, check, message, uri, severity, start, end, fix?, suggest? }`. The matched identifier (unknown filter name, undefined object, missing-partial path) lives ONLY interpolated in `message`. Porting the rule library without extending the seam would force either a regex over `message` (breaks the invariant) or a loss of hint specificity (breaks "tool for LLM"). See child 8.1.

3. THE RULE LIBRARY — v1 shipped 32 rule modules / 92 rules producing did-you-mean suggestions (`nearestByLevenshtein`), variant hints (`MissingPartial-invalid_lib_prefix` vs `-module`), confidence, see_also, and fixes; plus graph-aware queries. TASK-7.7 ("attach a hint by check code") is a placeholder for this. See child 8.3.

4. FULL RESULT CONTRACT — v1 `ValidateCodeResult` emits `tips`, `domain_guide`, `structural`, and `parse_error` in addition to what TASK-7.9 assembles. See child 8.4.

5. PARITY SAFETY NET — TASK-7.11 captures fresh baselines only; proving "functionality intact" needs a comparison against the 13 v1 baselines for unchanged-contract fields. See child 8.5.

## Constraints carried from TASK-7 (do not violate)
- No in-process LSP for linting. No regex over diagnostic `message` strings.
- Reuse `platformos-graph`, `AugmentedPlatformOSDocset`, check-common `find-root`, check-node fs — never re-implement.
- enrich/, advise/, result/ stay PURE (no node:fs / process / I/O); all I/O at the lint/ edge.
- Correctness checks live in check-common; the supervisor keeps ONLY agent ergonomics.

## Salvage / reference
- v1 source recoverable at git f60bc39; v1 prose/data salvaged under `docs/mcp-supervisor/salvage/` (hints, checks YAML, domain-gotchas, content-triggers, shopify-contamination, language-features, fixtures, parity corpus).
- `CURRENT_SYSTEM_ARCHITECTURE.md` §5.8–§5.12 (rule engine, enricher, pipeline, structural-warnings, fix-generator), §10 (v1 strips).

This is a tracking epic. See child tasks. Depends on TASK-7 (the clean minimal rebuild) being complete.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All child tasks completed
- [ ] #2 validate_code output reaches v1 parity for the LLM-facing contract (per-domain tips/gotchas/domain_guide, rule-library hints/suggestions/confidence/fixes, and the structural/parse_error fields), proven against the v1 baselines
- [ ] #3 No TASK-7 architectural invariant is violated by the restored logic (no LSP-for-lint, no regex over messages, one graph, one docset, pure enrich/result stages)
<!-- AC:END -->
