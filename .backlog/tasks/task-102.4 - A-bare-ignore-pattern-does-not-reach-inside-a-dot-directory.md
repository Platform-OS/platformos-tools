---
id: TASK-102.4
title: A bare ignore pattern does not reach inside a dot-directory
status: To Do
assignee: []
created_date: '2026-09-04 11:32'
labels:
  - bug
  - platformos-check-common
  - ignore
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.ts
parent_task_id: TASK-102
priority: low
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ignore: [node_modules]` does not ignore `.hidden/node_modules/foo.liquid`, though it does ignore `some-lib/node_modules/foo.liquid`.

MEASURED — the only difference between the two subjects is a path segment beginning with a dot.

WHY. A bare name is rewritten to `**/node_modules{,/**}`, and minimatch's `**` does not cross a
segment starting with `.` unless the matcher is built with `{ dot: true }`. `compiled()` constructs
`new Minimatch(pattern)` with no options, so every pattern inherits that.

SCOPE AND SEVERITY. Low, and deliberately filed as such: platformOS sources live under `app/` and
`modules/`, so a lintable file beneath a dot-directory is unusual. It is worth recording because
the behaviour is surprising rather than wrong-looking — a user who nests a vendored dependency
under a tooling directory gets no ignoring and no explanation — and because the same option
governs a pattern the user writes with a leading dot, which is worth settling in the same place.

DECIDE, DO NOT ASSUME. Turning `dot: true` on makes `**` cross dot-segments everywhere, which
widens EVERY existing pattern in every config, including the factory defaults. That is a
behaviour change with a blast radius well beyond this case, so measure what it does to the
existing pattern table before adopting it, and consider whether the honest answer is instead to
document the limitation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The behaviour of a bare pattern against a subject containing a dot-segment is settled: either it matches, or the limitation is documented at `compiled()`/`anyDepth` where a reader will meet it
- [ ] #2 If `dot: true` is adopted, its effect on the existing pattern table is measured and asserted — every spelling already covered by `ignore.spec.ts` keeps its current answer, or each change is deliberate and stated
- [ ] #3 A pattern the user writes with a leading dot (for example `.cache`) is covered by the same decision rather than left to differ
- [ ] #4 SABOTAGE-VERIFIED if behaviour changes: reverting makes the new assertion fail; the revert is undone afterwards and the suite is green
- [ ] #5 platformos-check-common and platformos-check-node suites pass, plus type-check and format:check
- [ ] #6 A changeset accompanies the change if behaviour changes
<!-- AC:END -->
