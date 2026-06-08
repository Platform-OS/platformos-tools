---
id: TASK-7.4
title: Scaffold the thin package skeleton + MCP stdio transport (stub handler)
status: To Do
assignee: []
created_date: '2026-06-08 10:01'
labels: []
dependencies:
  - TASK-7.1
references:
  - docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md
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
- [ ] #1 Package builds and type-checks; bin starts an MCP stdio server exposing validate_code
- [ ] #2 package.json has NO language-server dependency; the task-7.1 dependency guard passes
- [ ] #3 A smoke test drives the real bin over stdio (MCP SDK client) and gets the stub result
<!-- AC:END -->
