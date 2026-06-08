---
id: TASK-7
title: >-
  Rebuild platformos-mcp-supervisor from scratch as a thin agent-ergonomics
  layer on a structured contract
status: To Do
assignee: []
created_date: '2026-06-08 09:55'
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
