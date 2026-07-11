---
id: TASK-9.16
title: >-
  Scope lintBuffer's check pass to the buffer file (coreCheck runs whole-project
  per call)
status: To Do
assignee: []
created_date: '2026-07-02 08:26'
labels:
  - platformos-check-common
  - platformos-check-node
  - performance
  - mcp-supervisor
  - spike
dependencies: []
references:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-check-common/src/checks/partial-call-arguments/index.ts
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. TASK-9.13 memoized `getApp`, so the whole-project PARSE is no longer redone per call. But `lintBuffer` still runs `coreCheck(app, config, …)` over the ENTIRE app (all ~2,869 files) on every call, then filters the offenses down to the buffer's file. So every `validate_code` still does a whole-project CHECK pass to obtain one file's diagnostics — likely the next-largest per-call cost after the (now-fixed) parse.

INVESTIGATION-GATED. This task starts as a spike: first MEASURE the coreCheck pass cost per `lintBuffer` call on the real ~1,500-node project (isolate it from the docs-manager/network setup — the reason it couldn't be measured in 9.13). If coreCheck is NOT a material fraction of per-call latency once the parse is cached, CLOSE this as won't-do with the measurement recorded. Only proceed to implement if it is significant.

WHAT (if warranted). Add an opt-in way to obtain offenses for a SINGLE target file using the app as cross-file CONTEXT, without running every check over every file — e.g. `check(app, config, deps, { only: [uri] })` in check-common, consumed by `lintBuffer`. The app is still needed as context (cross-file checks like `MissingPartial`/`PartialCallArguments` resolve targets against other files), but per-file checks should only execute for the target.

CORRECTNESS (the hard part — investigate BEFORE building). The buffer-scoped offenses MUST equal the full-run offenses filtered to the buffer file. This requires auditing check-common's check model:
- Do any checks emit an offense on file A that is TRIGGERED by file B (i.e. offense location ≠ the visited file)? If so, naive "only run checks on the target" would miss or mislocate them. Enumerate such checks (onCodePathEnd/whole-app checks, cross-file emitters) and handle them.
- Determine whether coreCheck's architecture even supports per-file scoping cleanly, or whether it fundamentally visits all files.

CONSTRAINTS.
- check-common is the DEEPEST shared package (LSP, browser, CLI all consume it). The change MUST be additive/opt-in — `check()`'s existing contract and whole-project behaviour unchanged. Do not regress the LSP/CLI.
- Reuse the existing check runner; do not fork a parallel check engine.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SPIKE: measured coreCheck pass cost per lintBuffer call on the real ~1,500-node project (isolated from docs-manager setup), recorded in the task. Decision recorded: proceed vs close-as-won't-do based on whether it is a material per-call cost.
- [ ] #2 AUDIT: enumerate check-common checks that can emit an offense whose location is NOT the visited file (cross-file / whole-app emitters), documented — this bounds what buffer-scoping must preserve.
- [ ] #3 If warranted: an opt-in single-target check path (e.g. `{ only: [uri] }`) exists in check-common that returns offenses for the target file using the full app as cross-file context, WITHOUT running per-file checks over every file.
- [ ] #4 EQUIVALENCE INVARIANT (exhaustively tested): buffer-scoped offenses === full-run offenses filtered to the buffer file, across per-file checks AND cross-file checks (MissingPartial, PartialCallArguments, and any cross-file emitter found in the audit).
- [ ] #5 check()'s existing whole-project contract is unchanged; LSP/CLI/browser consumers unaffected (additive/opt-in).
- [ ] #6 lintBuffer uses the scoped path; measured per-call latency drop recorded.
- [ ] #7 TDD + comprehensive tests; check-common + check-node + supervisor suites + type-check + format + frozen-lockfile green.
<!-- AC:END -->
