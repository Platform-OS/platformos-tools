---
id: TASK-12.10
title: >-
  Re-key the partial-analysis cache on uri + fingerprint so its memory bound is
  meaningful
status: To Do
assignee: []
created_date: '2026-07-29 21:43'
updated_date: '2026-08-07 12:52'
labels:
  - performance
  - check-common
  - memory
dependencies: []
parent_task_id: TASK-12
priority: low
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-12.2's analysis cache is keyed on `globalObjectNames + NUL + full source text`, capped at 512 entries. Correctness is not in question — content keying is what makes the entry self-invalidating. The problem is that the KEY holds the partial's entire source, so the cap bounds entry COUNT while the actual memory varies with file size: ~1.5 MB for 512 typical 3 KB partials, but ~25 MB if they are 50 KB each. The limit was a judgement call, not a derived number.

Measured evidence that it is currently adequate, so this is an improvement rather than a fix: an A/B by CPU time (interleaved, 3 runs each, because wall clock was useless at load average 4.7) showed limit 512 at 14263 / 13659 / 14349 ms versus effectively unbounded at 15220 / 13016 / 13870 ms — statistically identical, i.e. no thrash on a project with 1190 partial/lib files, because only *referenced* targets get analyzed.

This branch makes a better key available: `fileFingerprint` (`mtimeMs:ctimeMs:size`) already exists in check-node. Keying on `uri + fingerprint` makes keys tiny and constant-size, so the entry cap becomes a real memory bound, and it stays correct because the fingerprint changes whenever content does (TASK-12.4's `ctimeMs` closes the forgery hole that would otherwise make this keying weaker than content keying).

The trade to weigh explicitly: it costs one `stat` per call site on a file that is being read anyway, and it moves the check from "provably cannot be stale" to "as fresh as the fingerprint" — the same guarantee `AppCache` already relies on. If that trade is judged not worth it, closing this as won't-do with the A/B numbers recorded is a legitimate outcome.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded: re-key on uri+fingerprint, or close as won't-do with the measured A/B retained as the justification
- [ ] #2 If implemented: cache keys are constant-size (no source text retained in keys or values), verified by inspection and a test
- [ ] #3 If implemented: an edited partial is re-analyzed — including the equal-length-edit-under-restored-mtime case that `ctimeMs` now catches
- [ ] #4 If implemented: PartialCallArguments offenses unchanged on a real multi-hundred-file project (byte-identical whole-project output)
- [ ] #5 If implemented: retained memory for the cache measured before/after with forced GC, and the entry cap justified against that measurement
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — still open, but the proposed mechanism no longer exists

**The problem is real and unchanged.** `createBoundedCache`'s two consumers still key on
file CONTENT, so the 512-entry cap bounds entry count while actual memory varies with
file size — exactly as described. `utils/bounded-cache.ts` documents the content-keying
("Callers are expected to key on the exact input the result depends on (typically file
content), so an entry can never be stale").

**The proposed fix cannot be applied as written.** This task's plan is to re-key on
`uri + fileFingerprint`, and **`fileFingerprint` no longer exists** in
`platformos-check-node/src` — it was removed with `AppCache` during the lazy-`App` epic
(TASK-46). The only surviving mentions are historical comments in the supervisor's
`graph-cache-store.ts`.

Whoever picks this up must first decide what replaces it. The `App` model now owns file
identity and freshness, so the natural key is probably `AppFile`'s identity plus its
loaded version rather than a `stat`-derived fingerprint — which also removes the "one
extra `stat` per call site" cost this task weighed as the main trade.

The task's own A/B numbers still stand (limit 512 vs unbounded: statistically identical
on a 1190-partial project), so **closing this as won't-do remains a legitimate outcome**,
as the description already says.
<!-- SECTION:NOTES:END -->
