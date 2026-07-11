---
id: TASK-9.22.2
title: >-
  Convert graph incremental/deserialize specs to MockFileSystem + template
  literals
status: Done
assignee: []
created_date: '2026-07-07 10:13'
updated_date: '2026-07-07 10:46'
labels:
  - tests
  - platformos-graph
dependencies: []
modified_files:
  - packages/platformos-graph/src/graph/incremental.spec.ts
  - packages/platformos-graph/src/graph/deserialize.spec.ts
parent_task_id: TASK-9.22
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/platformos-graph/src/graph/incremental.spec.ts` and `deserialize.spec.ts` build a real project on disk (`mkdtemp`, `mkdir`, `writeFile`, `rm`, `NodeFileSystem`) and mutate files mid-test. buildAppGraph/applyFileChange/recursiveReadDirectory all run over any `AbstractFileSystem`, and `MockFileSystem` (from platformos-check-common test utils) reads live from its backing object — so a mutable in-memory mock (mutate the backing MockApp object to simulate add/modify/delete) fully covers these scenarios without touching disk. Convert both specs to MockFileSystem; drop the node fs/tmpdir plumbing.

Also replace the `[...].join('\n')` line-array literals (e.g. GET_POSTS_GRAPHQL and the inline page writes) with template-literal (backtick) strings for readability.

Scope note: `app-cache.spec.ts` (platformos-check-node) is intentionally excluded — it exercises `getApp`, which globs real disk, so it legitimately needs a real workspace. Supervisor `graph-cache.spec.ts` is excluded — it asserts mtime/size fingerprint rebuild behavior that needs real stat.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 incremental.spec.ts and deserialize.spec.ts use MockFileSystem with no node:fs / mkdtemp / tmpdir usage
- [x] #2 In-test file add/modify/delete is simulated by mutating the mock's backing object; all existing scenarios (add/modify/delete, missing-target flips, leaf GC, self-ref, cycles, mixed sequence, round-trip, reconcile-equals-full-build) still pass
- [x] #3 Multi-line fixture strings use template literals instead of [...].join('\n')
- [x] #4 Equivalence-to-full-build assertions remain intact and green
- [x] #5 tests and format:check pass for platformos-graph
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Converted the two graph specs off real disk onto the in-memory MockFileSystem, and replaced the line-array string idiom with template literals.

Approach (verified with a throwaway spike before rewriting): `buildAppGraph`, `applyFileChange`, and `recursiveReadDirectory` all run over any `AbstractFileSystem`; `MockFileSystem` (imported as the established cross-package pattern `@platformos/platformos-check-common/dist/test`, same as the LSP specs) reads live from its backing object. So in-test add/modify/delete is a plain mutation of that object (`files[rel] = ...` / `delete files[rel]`) — no `mkdtemp`/`writeFile`/`rm`/`NodeFileSystem`/`afterEach` cleanup. Deps augmentation happens per `buildFull`/`change` call, so each re-reads the current mock state (never a stale parse), preserving the equivalence-to-full-build guarantee. `rootUri = path.normalize('file:/')` and `uri = path.join(rootUri, rel)` follow check-common's own MockFileSystem convention; node keys and edge `source.uri` match it (proven by the passing explicit dependents assertions).

- incremental.spec.ts: all 12 scenarios preserved (add/modify/delete, missing-target `exists` flip, leaf GC, self-reference, cycle, mixed sequence, unmodeled-file no-op) + the 9.22.4 `.tables` assertion. `GET_POSTS_GRAPHQL` and every inline page/layout write are now template literals.
- deserialize.spec.ts: all 5 scenarios preserved (round-trip identity, reverse-index queryable, restored-graph reconciles-exactly-like-full-build, add+delete reconcile, dangling-edge drop). Page writes → template literals.

Verification: 17 tests pass (12 + 5), full graph suite 101, graph type-check clean (tsc exit 0), prettier clean. No disk I/O remains (grep for node:fs/mkdtemp/tmpdir/NodeFileSystem/`].join('` is empty). Bonus: the suite is markedly faster with no filesystem round-trips.
<!-- SECTION:FINAL_SUMMARY:END -->
