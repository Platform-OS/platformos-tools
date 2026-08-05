---
id: TASK-11.4
title: >-
  Agent drivers: opencode-headless + Anthropic-MCP-connector behind one
  AgentDriver interface
status: To Do
assignee: []
created_date: '2026-07-09 11:01'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
  - drivers
dependencies:
  - TASK-11.1
parent_task_id: TASK-11
priority: medium
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Abstract the model-under-test behind one `AgentDriver` interface so the same assertion engine grades any agent, and add the second (API) driver. The 11.1 opencode driver is promoted to this interface.

## Interface
`AgentDriver.run({ brief, workspace, mcpConfig, timeout }) -> { transcript, toolCalls, artifacts, iterations, exitReason }` where `mcpConfig` wires the pos-supervisor (system under test) + pos-cli (to act on staging). `iterations` (agent turns / edit-validate loops) feeds the 11.6 supervisor-lift metric. Drivers are stateless per task and produce the same artifact shape.

## Implementations
- opencode headless (from 11.1, refactored to the interface): `opencode run "<brief>"` with the supervisor + pos-cli in its MCP config; parse its transcript/tool-log.
- Anthropic MCP connector: drive the Anthropic API with the MCP connector so Claude-as-agent connects to the same MCP servers; capture the tool-use trace. Model + connector config via env.

## Requirements
- Both drivers hand the runner an identical result shape; the grader engine and runner are driver-agnostic.
- Deterministic knobs where the provider allows (temperature, seed, max turns) recorded in the row for reproducibility.
- A `--driver opencode|anthropic` switch; a `mock` driver (replays a fixed transcript / applies a fixed diff) for harness self-tests without spending tokens.
- Timeouts and non-completion (agent gives up / hits max turns) are first-class `exitReason`s, not crashes.

## Grounding
Anthropic: "we're evaluating the harness and the model working together" — so the driver (harness) is an explicit, swappable axis; the mock driver lets the harness itself be tested deterministically.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single AgentDriver interface returns {transcript, toolCalls, artifacts, iterations, exitReason}; the runner + graders are driver-agnostic
- [ ] #2 opencode-headless and Anthropic-MCP-connector drivers both implement it and connect the agent to pos-supervisor + pos-cli
- [ ] #3 A mock driver replays a fixed transcript/diff so the harness is testable without token spend
- [ ] #4 --driver selects the implementation; per-run knobs (model, temperature, max-turns) are recorded in the result row
- [ ] #5 Timeout / max-turns / agent-gave-up are reported as structured exitReasons, never uncaught failures
- [ ] #6 iterations (edit-validate turns) is captured for the supervisor-lift metric
<!-- AC:END -->
