---
id: TASK-7.4
title: Scaffold the thin package skeleton + MCP stdio transport (stub handler)
status: Done
assignee:
  - filip
created_date: '2026-06-08 10:01'
updated_date: '2026-06-09 21:36'
labels: []
dependencies:
  - TASK-7.1
references:
  - docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md
modified_files:
  - packages/platformos-mcp-supervisor/package.json
  - packages/platformos-mcp-supervisor/tsconfig.json
  - packages/platformos-mcp-supervisor/tsconfig.build.json
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/logger.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - packages/platformos-mcp-supervisor/src/bin/args.ts
  - packages/platformos-mcp-supervisor/src/bin/args.spec.ts
  - packages/platformos-mcp-supervisor/src/bin/platformos-mcp-supervisor.ts
  - packages/platformos-mcp-supervisor/src/index.ts
  - packages/platformos-mcp-supervisor/test/integration/stdio-smoke.spec.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Create the new `packages/platformos-mcp-supervisor` skeleton with the module boundaries from the architecture doc and a working MCP stdio server whose `validate_code` handler returns a typed stub.

## Scope
- package.json (THIN deps: `@modelcontextprotocol/sdk`, `@platformos/platformos-check-node`, `@platformos/platformos-check-common` [types], `@platformos/platformos-graph`, `@platformos/platformos-check-docs-updater`, `zod`). NOTE: NO `platformos-language-server-*` dependency.
- tsconfig.build + vitest config (single-fork) matching repo conventions.
- Directory skeleton: `transport/`, `lint/`, `enrich/`, `advise/`, `result/`, `data/`, `bin/`.
- `bin/platformos-mcp-supervisor.ts` (#!/usr/bin/env node), `--project`/env resolution, lifecycle (SIGINT/SIGTERM), stderr-only logger.
- `transport/`: McpServer, StdioServerTransport, register `validate_code` with a zod input schema; handler returns a typed stub `ValidateCodeResult`.
- `result/types.ts`: the `ValidateCodeResult` contract (typed).

## Out of scope
- Real linting/enrichment (later tasks). Handler is a stub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Package builds and type-checks; bin starts an MCP stdio server exposing validate_code
- [x] #2 package.json has NO language-server dependency; the task-7.1 dependency guard passes
- [x] #3 A smoke test drives the real bin over stdio (MCP SDK client) and gets the stub result
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (TASK-7.4)
Scaffold the thin package + working MCP stdio server with a typed stub `validate_code`.

- package.json: thin deps (@modelcontextprotocol/sdk, check-node, check-common, check-docs-updater, graph, zod). NO language-server. bin → dist/bin.
- tsconfig.json/tsconfig.build.json: extend root, paths+references to the 4 workspace deps (prepares 7.6); specs excluded from build; rootDir src.
- result/types.ts: the ValidateCodeResult contract (parity-aligned field names; TASK-8 fields tips/domain_guide/structural declared optional).
- logger.ts: stderr-only.
- transport/validate-code.ts: zod input shape + stub handler returning a well-formed ValidateCodeResult, serialized as one JSON text block. registerTool cast to a shallow local signature to dodge the SDK ShapeOutput TS2589 (zod 3.25).
- transport/server.ts: startServer (McpServer + StdioServerTransport + SIGINT/SIGTERM).
- bin/args.ts (pure parse/resolve, unit-tested) + bin/platformos-mcp-supervisor.ts (runs main on load).
- index.ts re-exports.
- test/integration/stdio-smoke.spec.ts: builds the package then drives the real bin via the MCP SDK StdioClientTransport.

## Verify
- build + type-check clean; package vitest 22/22 (args 8, guards 12, smoke 2); registry consumers (language-server-common + check-browser) 466/466.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scaffolded the thin package and a working MCP stdio server with a typed stub `validate_code`.

**Package config:** `package.json` with THIN deps (`@modelcontextprotocol/sdk`, check-node, check-common, check-docs-updater, graph, zod) and **no language-server dependency**; `bin` → `dist/bin/platformos-mcp-supervisor.js`. `tsconfig.json` + `tsconfig.build.json` extend the root, map paths + references to the four workspace deps (prepares TASK-7.6), exclude specs from the build, `rootDir: src`. No per-package vitest config — the root config discovers the specs (matches siblings).

**Contract:** `src/result/types.ts` defines `ValidateCodeResult` and friends (`ValidateCodeDiagnostic`, `AgentFix`, `ProposedFix`, `DiagnosticCluster`, `ScorecardNote`), field names aligned to v1 for the TASK-8.5 parity net. TASK-8 fields (`tips`, `domain_guide`, `structural`) are declared optional so the shape is stable but only populated later.

**Transport:** `transport/server.ts` `startServer` wires `McpServer` + `StdioServerTransport` + SIGINT/SIGTERM. `transport/validate-code.ts` registers `validate_code` with a zod input shape and a stub handler that returns a well-formed result serialized as one JSON text block. `registerTool` is cast to a shallow local signature to sidestep the SDK's `ShapeOutput` TS2589 deep-instantiation under zod 3.25 (runtime validation unchanged; handler casts validated args to `ValidateCodeParams`).

**Bin:** pure `bin/args.ts` (`parseArgs`/`resolveProjectDir`/`HELP`, unit-tested) split from `bin/platformos-mcp-supervisor.ts` (runs `main()` on load) so the args are testable without booting a server. Project-dir precedence: `--project` > `POS_SUPERVISOR_PROJECT_DIR` > cwd. `index.ts` re-exports the public surface.

**Logger:** stderr-only (stdout reserved for JSON-RPC).

**Tests:** `src/bin/args.spec.ts` (8) pins arg/dir resolution; `test/integration/stdio-smoke.spec.ts` (2) builds the package (incremental `tsc -b` in beforeAll) then drives the REAL bin via the MCP SDK `StdioClientTransport` — asserts it advertises exactly `validate_code` and returns a well-formed `ValidateCodeResult`.

**Verification:** build + type-check clean; stale v1 `dist/` wiped and rebuilt clean. Package vitest 22/22 (args 8 + architecture guards 12, now incl. the active package.json language-server denylist → AC#2 + smoke 2 → AC#3). No global regression: check-common 1037, check-node 98, language-server-common + check-browser 466. Prettier-clean.
<!-- SECTION:FINAL_SUMMARY:END -->
