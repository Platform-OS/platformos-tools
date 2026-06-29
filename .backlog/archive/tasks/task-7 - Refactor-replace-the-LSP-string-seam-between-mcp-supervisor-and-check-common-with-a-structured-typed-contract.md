---
id: TASK-7
title: >-
  Refactor: replace the LSP-string seam between mcp-supervisor and check-common
  with a structured, typed contract
status: To Do
assignee: []
created_date: '2026-06-08 09:37'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/ARCHITECTURE.md
  - packages/platformos-check-common/CLAUDE.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

Research (2026-06-08) comparing `packages/platformos-check-common` (the runtime-agnostic linting engine, 35 `CheckDefinition`s, ~11.3k LOC) and `packages/platformos-mcp-supervisor` (the agent-facing MCP server, single `validate_code` tool, ~16.3k LOC) found that the two packages SHOULD remain separate (different runtimes, audiences, and stability contracts) but are currently joined by the WRONG seam.

### The core problem: a lossy structured -> string -> structured round-trip

check-common produces structured `Offense` objects (check code, range, structured `fix`/`suggest` correctors). The supervisor never calls check-common's `check()` directly — it boots the full language server in-process over a PassThrough stream pair (`src/core/lsp-client.ts`), awaits `publishDiagnostics`, and receives FLAT LSP `Diagnostic` strings with the structured fix/suggest dropped. It then regex-parses those English messages back into structured params (`src/core/diagnostic-record.ts`, 16 per-check extractors that "MUST match the source byte-for-byte", pinned only by a 23-case contract test) and regenerates fixes from scratch (`src/core/fix-generator.ts`, ~1.7k LOC).

This duplicates intelligence and connects it with a brittle string contract: a wording change in check-common silently breaks supervisor params, hints, and fixes.

### North star

check-common = single source of truth for detection + structured fixes. mcp-supervisor = thin agent-facing orchestration + ergonomics (prose hints, confidence, clustering, next_step, scorecard) that consumes STRUCTURED output. Keep two packages; move the seam to a typed structured API (Offense + docset + graph), not a serialized LSP/JSON-RPC string protocol.

### Why keep them separate (must survive the refactor)
1. Runtime boundary — check-common is browser-safe; supervisor is hard Node (fs, MCP SDK, stdio).
2. Different consumers / stability contracts — `Offense` is stable (editors/CLI/browser); `ValidateCodeResult` churns with agent tuning.
3. Detection vs remediation-advice-for-an-LLM are different concerns.
4. Dependency weight (MCP SDK, zod, data payload) must not leak into the core lib.
5. Independent test surfaces (parity/stdio vs per-check unit pins).

This is the tracking epic. See child tasks for the work breakdown.

### Reference docs
- `packages/platformos-mcp-supervisor/ARCHITECTURE.md`
- `packages/platformos-check-common/CLAUDE.md`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All child tasks completed
- [ ] #2 Two packages remain separate; the seam between them is a typed structured API (no regex parsing of LSP message strings remains in the supervisor)
- [ ] #3 No net regression in the supervisor parity/integration/upstream test suites
<!-- AC:END -->
