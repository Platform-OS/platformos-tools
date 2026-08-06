---
id: TASK-9.16
title: >-
  Scope lintBuffer's check pass to the buffer file (coreCheck runs whole-project
  per call)
status: Done
assignee: []
created_date: '2026-07-02 08:26'
updated_date: '2026-07-29 21:41'
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
- [x] #1 SPIKE: measured coreCheck pass cost per lintBuffer call on the real ~1,500-node project (isolated from docs-manager setup), recorded in the task. Decision recorded: proceed vs close-as-won't-do based on whether it is a material per-call cost.
- [x] #2 AUDIT: enumerate check-common checks that can emit an offense whose location is NOT the visited file (cross-file / whole-app emitters), documented — this bounds what buffer-scoping must preserve.
- [x] #3 If warranted: an opt-in single-target check path (e.g. `{ only: [uri] }`) exists in check-common that returns offenses for the target file using the full app as cross-file context, WITHOUT running per-file checks over every file.
- [x] #4 EQUIVALENCE INVARIANT (exhaustively tested): buffer-scoped offenses === full-run offenses filtered to the buffer file, across per-file checks AND cross-file checks (MissingPartial, PartialCallArguments, and any cross-file emitter found in the audit).
- [x] #5 check()'s existing whole-project contract is unchanged; LSP/CLI/browser consumers unaffected (additive/opt-in).
- [x] #6 lintBuffer uses the scoped path; measured per-call latency drop recorded.
- [x] #7 TDD + comprehensive tests; check-common + check-node + supervisor suites + type-check + format + frozen-lockfile green.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered under TASK-12.3 (same design this task specified: `check(app, config, deps, { only: [uri] })` consumed by `lintBuffer`). Closing here to prevent duplicate work.

AC#1 SPIKE — measured on pos-module-mcp (162-file app; 1392 liquid + 217 graphql on disk): the whole-project `coreCheck` pass was 21350 ms per call versus 81 ms for the buffer's file alone, against `getApp` at 3645 ms. So the check pass was NOT merely "next-largest after the parse" — it was ~5x the parse and the dominant per-call cost. Proceed was the correct decision.

AC#2 AUDIT — the concern (a check emitting an offense whose location is not the visited file) is structurally impossible: `check()` has exactly ONE `offenses.push`, in `createContext`'s `report`, and it hardcodes `uri: file.uri`. Every offense therefore belongs to the visited file, so no cross-file emitter exists to preserve. `isDisabled` likewise keys strictly on `offense.uri`, so per-file `platformos-check-disable` comments stay correct under scoping. Both facts are pinned by tests.

AC#3/#5 — `CheckOptions { only?: UriString[] }` added as an optional 4th parameter; each SourceCodeType branch filters via `filesToVisit`. The complete `app` is still passed so the cross-file dependencies built from it (`getDefaultTranslations`, `getTranslationsForBase`, `getRouteTable`, `fileExists`) are unchanged. All four existing callers (test-helper, LSP `runChecks`, check-browser, check-node) are untouched at their call sites.

AC#4 EQUIVALENCE — verified in unit tests AND in the wild: a script compared `lintBuffer` against `appCheckRun`'s whole-project offenses filtered to the same uri over dna-idea (all 87 files, 21 with offenses), pos-module-mcp (25 files) and poetry-blog (25 files, 101 offending files among them) — 0 mismatches on every field including ranges and fix/suggest presence.

AC#6 — per-call check time 21350 ms → 81 ms. End-to-end `validate_code` on that project went 26 s → 5.8 s with the memoizations, and → 0.9 s once combined with this branch's `AppCache`.

AC#7 — check-common 1055, check-node, supervisor, LSP 474, browser, graph suites green; monorepo type-check and format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
