---
id: TASK-7
title: >-
  Rebuild platformos-mcp-supervisor from scratch as a thin agent-ergonomics
  layer on a structured contract
status: To Do
assignee: []
created_date: '2026-06-08 09:55'
updated_date: '2026-06-09 21:40'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/salvage
  - docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why rebuild instead of refactor

The original `platformos-mcp-supervisor` (removed at git f60bc39; reusable assets salvaged to `docs/mcp-supervisor/salvage/`) was joined to the linting engine by the WRONG seam. It booted the full language server in-process over PassThrough streams, received FLAT LSP message strings (structured fix/suggest dropped), regex-parsed those English messages back into params (`diagnostic-record.ts`, "byte-for-byte" pinned), regenerated fixes from scratch (`fix-generator.ts`, ~1.7k LOC), re-derived the project graph and docset, and corrected its own false positives in a 15-step "load-bearing ordered" pipeline. ~16.3k LOC, much of it duplicated intelligence connected by a brittle string contract.

We start clean.

## Target architecture (the sound design)

```
platformos-check-common      detection + STRUCTURED fixes (runtime-agnostic) — SINGLE SOURCE OF TRUTH
      ^
platformos-check-node        Node FS + docset wiring; batch check() -> Offense[]
platformos-graph             cross-file dependency graph (the ONLY graph)
platformos-check-docs-updater docset JSON
      ^
platformos-mcp-supervisor (NEW, thin)
   - transport/   MCP stdio server, validate_code tool, lifecycle
   - lint/        adapter: check-node check() -> internal structured DiagnosticModel
                  project context via platformos-graph + AugmentedPlatformOSDocset
   - enrich/      PURE (StructuredDiagnostic[], ProjectContext) -> EnrichedDiagnostic[]
                  data-driven hints, confidence, FixDescription -> agent Fix, see_also
   - advise/      ergonomic-only advisories (pos-supervisor: namespace, NO overlap with check codes)
   - result/      order-INDEPENDENT transforms -> ValidateCodeResult (cluster, scorecard, status)
   - data/        prose + knowledge ONLY (base metadata derived from check meta)
```

## Architectural invariants (enforced, not aspirational)

1. NO in-process LSP for linting. Lint via a direct `check()` call. (LSP only ever for hover/completion, if needed.)
2. NO string round-trip. Enrichment consumes STRUCTURED `Offense` (typed fields + structured fix/suggest). No regex over messages.
3. ONE graph (platformos-graph), ONE docset wrapper (AugmentedPlatformOSDocset). No duplicates.
4. Correctness lives in check-common as CheckDefinitions. The supervisor keeps ONLY agent ergonomics.
5. Enrichment + result assembly are PURE functions; all I/O (fs scan, docset load) at the edges. No load-bearing step ordering.
6. ONE source of check metadata: prose in data/, base metadata (code/desc/severity) from check meta.
7. The package stays a leaf consumer; the seam to the engine is a TYPED API, never a serialized string protocol.

## Keep the packages separate (still true)
Runtime boundary (browser-safe core vs Node server), divergent stability contracts (Offense stable vs ValidateCodeResult churns), detection-vs-advice separation, dependency weight, distinct test surfaces.

## Salvage inventory (reuse, do not re-author)
- `docs/mcp-supervisor/salvage/data/` — knowledge.json, hints/*.md, checks/*.yml, gotchas, content-triggers, shopify contamination, language-features
- `docs/mcp-supervisor/salvage/fixtures/` — project (26 files), broken-project (43), parity corpus
- `docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md` — old design (for reference; describes what NOT to rebuild)
- Old code recoverable at git f60bc39 (branch fk-pos-supervisor-migration history)

This is the tracking epic. See child tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All child tasks completed
- [ ] #2 New package builds, type-checks, and ships validate_code via stdio
- [ ] #3 No code path boots a language server for linting; no module regex-parses LSP message strings; no duplicate project graph or docset wrapper exists
- [ ] #4 Correctness detection lives in check-common; the supervisor contains only orchestration + agent ergonomics
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Progress checkpoint — 2026-06-09: subtasks 7.1–7.4 complete (4 of 11)

The rebuilt package now exists and runs end-to-end over MCP stdio with a typed stub `validate_code`. No global regressions across the monorepo.

| Task | Result | Verification |
|------|--------|-------------|
| **7.1** Architecture + guards | ADR `docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/`, package `ARCHITECTURE.md`, 3 machine-enforced invariant guards (no-LSP-on-lint-path, enrich/result purity, no-regex-over-message) under `test/guards/` | 12/12 guard tests; proven to bite on injected violations |
| **7.2** Promote correctness checks | Classified all 16 old structural detectors (table committed to ADR 002 appendix). PROMOTED 2 → check-common: `GraphqlMultilineInLiquidBlock`, `MissingContentForLayout`. DROPPED 4 already-engine-owned (DeprecatedTag/InvalidLayout/InvalidMethod/unknown-key InvalidFrontMatter). 10 ERGONOMIC → TASK-8. Shopify obj/tag = ergonomic (enrichment over UndefinedObject/UnknownTag, user-approved) to avoid recreating the dedup collision. Factory configs regenerated. | check-common 1037/1037; check-node 98/98 |
| **7.3** check-node lint seam | `lintBuffer({root,filePath,content,configPath?})` — loads project from disk, overlays the in-memory buffer, returns structured `Offense[]` for the file with fix/suggest intact; NO LSP/subprocess. Shared `lintApp` helper; README + new check-node CLAUDE.md. | check-node 98/98 (3 new hermetic specs) |
| **7.4** Package scaffold | Thin `package.json` (NO language-server dep), tsconfig(.build), `result/types.ts` (ValidateCodeResult contract, v1-aligned for parity; TASK-8 fields optional), stderr logger, `transport/` (McpServer+stdio+stub handler), `bin/` (args split + lifecycle), index. | package 22/22 (args 8 + guards 12 incl. active pkg.json denylist + smoke 2); language-server-common + check-browser 466/466 |

**Architectural invariants holding:** no in-process LSP for lint; structured `Offense` seam (no message round-trip); single source of truth for checks in check-common; reuse find-root/graph/docset (named in 7.6); enrich/result to stay pure.

**Scope reminder (user directive):** TASK-7 ships the clean MINIMAL `validate_code`. Per-domain rules, the rule library, and the full result fields (tips/domain_guide/structural) are deferred to the TASK-8 epic. Keep 7.5/7.7/7.8/7.9 lean.

**Remaining (integration half):** 7.6 lint adapter (ProjectContext: graph+docset+findRoot → lintBuffer → StructuredDiagnostic) [deps 7.2/7.3/7.4 all done] → 7.5 data (trimmed) → 7.7 enrich (minimal) → 7.8 advise (minimal) → 7.9 result assembly → 7.10 wire real handler → 7.11 tests + fresh baselines.

Verification commands used: `yarn vitest run <pkg>`, `yarn workspace <pkg> type-check`, `yarn workspace @platformos/platformos-mcp-supervisor build`.
<!-- SECTION:NOTES:END -->
