---
id: TASK-9.22.3
title: Document AppCache rationale in platformos-check-node (keep in place)
status: Done
assignee: []
created_date: '2026-07-07 10:13'
updated_date: '2026-07-07 10:48'
labels:
  - docs
  - platformos-check-node
dependencies: []
modified_files:
  - packages/platformos-check-node/src/index.ts
parent_task_id: TASK-9.22
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review flagged the `AppCache` placement/existence. Investigation: there is NO pre-existing equivalent in platformos-check-node; the LSP's DocumentManager/AppGraphManager are a different runtime and concern (open editor buffers / the app graph, not a getApp parsed-source cache), and the supervisor GraphCache caches the graph, not lint sources. AppCache is correctly co-located with its only caller (`getApp`, which globs real disk — node-only) and belongs in check-node, the package's I/O shell. No code moves.

Action: add a concise rationale note (JSDoc on the AppCache class in packages/platformos-check-node/src/index.ts, and/or a line in the package CLAUDE.md) stating WHY it exists (dominant per-call cost is the whole-project parse; opt-in, never-stale via per-file fingerprint) and WHY it lives here (tied to getApp/glob; no equivalent elsewhere) so the placement is self-defending on future review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AppCache carries a short rationale note explaining its purpose and why it lives in platformos-check-node (not common/LSP)
- [x] #2 Note explicitly records that no pre-existing equivalent mechanism was found
- [x] #3 No code moved; existing app-cache.spec.ts remains green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a PLACEMENT paragraph to the AppCache JSDoc (packages/platformos-check-node/src/index.ts) — the existing doc already covered purpose + never-stale, so this adds only what the review actually asked for and avoids restating.

The note states: AppCache belongs in check-node (the lint I/O shell), not platformos-common or the LSP, because it caches `getApp`'s output and `getApp` globs the real filesystem — a Node-only concern (common is browser-safe, no glob). It explicitly records that it is the ONLY parsed-project cache in check-node and no pre-existing mechanism duplicates it, distinguishing the nearest neighbours (LSP `DocumentManager` = open editor buffers; supervisor `GraphCache` = the dependency graph) as different runtimes/payloads that are deliberately not shared.

No code moved. Verified: prettier clean, check-node type-check clean (tsc exit 0), app-cache.spec still green (6/6), dist rebuilt so the .d.ts carries the note.
<!-- SECTION:FINAL_SUMMARY:END -->
