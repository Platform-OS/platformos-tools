---
id: TASK-8.1
title: >-
  Extend the check-common seam with structured identifiers (typed data on
  Offense/report)
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
labels: []
dependencies:
  - TASK-7
references:
  - packages/platformos-check-common/src/types.ts
  - packages/platformos-check-common/src/checks
parent_task_id: TASK-8
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Extend `platformos-check-common` so each `Offense` can carry a typed, structured `data` payload (the matched identifier(s) and any suggestion candidates a check already computed), and populate it in the checks the supervisor enriches. This makes the structured identifier available downstream WITHOUT any consumer regex-parsing the diagnostic `message`.

## Why
Verified against `packages/platformos-check-common/src/types.ts` (Offense at ~line 526): the type is `{ type, check, message, uri, severity, start, end, fix?, suggest? }`. The matched identifier (e.g. the unknown filter name in `Unknown filter '${node.name}' used.`) exists ONLY inside the interpolated `message`. The supervisor rule library (task-8.3) needs that identifier to pick hint variants and render `{{var}}` substitutions. Without this extension the supervisor would have to regex `message` (violates the TASK-7 no-string-round-trip invariant) or emit generic hints (regresses the "tool for LLM" quality). check-common ALREADY knows the identifier structurally at report time — this task stops throwing it away at the seam.

## Scope
- Add a typed, optional `data` field to the `Offense`/`Problem` contract (a discriminated or per-check-keyed payload; minimal and additive — must not destabilize existing editor/CLI/browser consumers).
- Thread it through `context.report({...})` so checks can attach it.
- Populate `data` in the checks the supervisor enriches (at minimum the v1-enriched set: UnknownFilter, UndefinedObject, MissingPartial, MissingPage, TranslationKeyExists, UnknownProperty, DeprecatedTag, MissingRenderPartialArguments, MetadataParamsCheck/PartialCallArguments, UnusedAssign, GraphQLCheck). Carry the matched identifier and, where the check computed one, the suggestion candidate.
- Keep `data` runtime-agnostic (no Node-only types) so the browser build is unaffected.

## Out of scope
- Supervisor consumption of `data` (task-8.3).
- Any regex fallback in the supervisor (must not exist).

## Notes
- This is a check-common change with cross-package blast radius — coordinate with the editor/CLI/browser consumers and keep the field additive. Pin the new shape with per-check unit specs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Offense can carry an optional typed `data` payload defined in check-common types, additive and runtime-agnostic (browser build unaffected)
- [ ] #2 Every check in the v1-enriched set populates `data` with the matched identifier (and suggestion candidate where the check computes one)
- [ ] #3 A check-common unit spec pins the `data` shape for representative checks; existing editor/CLI/browser consumers still compile and pass
- [ ] #4 No downstream consumer needs to read the diagnostic `message` string to recover the matched identifier
<!-- AC:END -->
