---
id: TASK-100.3
title: 'Record that worthReading is a performance guard, not a correctness one'
status: Done
assignee: []
created_date: '2026-09-03 06:31'
updated_date: '2026-09-03 07:47'
labels:
  - documentation
  - platformos-mcp-supervisor
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/validate/validate-buffers.ts
parent_task_id: TASK-100
priority: low
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In `src/validate/validate-buffers.ts` (around line 366) the `worthReading` guard decides whether the project scan is pre-warmed:

    const worthReading =
      ctx.impactEnabled !== false &&
      lintable.some((buffer) => canHaveDependants(...));

    warm: () => (worthReading ? scan.sources().catch(() => undefined) : Promise.resolve()),

SIX mutants survive on that one condition, including replacing it outright with BOTH `true` and `false`, plus `.some` becoming `.every`. Read cold, that looks alarming — a guard nothing observes.

It is not a bug, and the reason is worth writing down. `warm()` only PRE-warms: impact later awaits the same memoized `scan.sources()` promise itself, so an inverted guard costs either a wasted project read or a colder path, never a wrong answer. That is why no assertion moves when it flips, and it is why this sits at the bottom of the priority order despite the survivor count.

This task is DOCUMENTATION ONLY. No behavioural change, no new test. The point is that the next reader — very possibly the next person to run mutation testing here — should not have to re-derive the same conclusion, and should not "fix" a guard that is doing exactly what it should.

Note the neighbouring claim in the same file, that `--no-impact` "costs NOTHING", is likewise unverified by any test. Pinning it is deliberately NOT in scope here; the comment should be accurate about what is and is not proven.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A comment at the `worthReading` declaration states that it is a performance guard and that inverting it cannot change a verdict
- [x] #2 The comment names the mechanism: `warm()` only pre-warms, and impact awaits the same memoized `scan.sources()` promise itself
- [x] #3 The comment does not claim the `--no-impact` cost behaviour is tested, because it is not
- [x] #4 No behavioural change and no new test in this task; the suite is green and unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the mechanism before writing it down, rather than restating the task: confirm `sources()` really memoizes (`pending ??= readEdgeSources(...)` in `impact/project-scan.ts`) and that impact really awaits that same promise itself (`impact.ts:146`, `dependants.ts:71` — the only two other callers).
2. Establish what is actually tested about the neighbouring `--no-impact` claim before writing about it.
3. Add the comment at the `worthReading` declaration, below the existing intent comment rather than replacing it.
4. Confirm the change is additive-only (`git diff` removes zero lines), the suite is unchanged, and prettier and type-check are clean.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The mechanism was verified rather than taken from the task description. `createProjectScan` memoizes with `pending ??= readEdgeSources(...)`, and `scan.sources()` has exactly three call sites: `warm()` here, `impact.ts:146` and `dependants.ts:71`. The latter two await it themselves, so `warm()` is genuinely only a head start.

ONE CORRECTION TO THE TASK'S FRAMING, worth recording because it is the kind of compound claim CLAUDE.md warns about. The task says the neighbouring `--no-impact` "costs NOTHING" claim is "likewise unverified by any test". It is unverified in HALF. That sentence makes two claims, and they have different evidence:
  - "the two extra lint passes never start" IS pinned — `validate-code.spec.ts`, 'reports disabled, and never calls the impact adapter at all', asserts `called: false` against an injected impact adapter.
  - "`projectScan` declines to read" is NOT pinned by anything. No test observes the filesystem, and with `projectDir: '/srv/app'` on a `NodeFileSystem` a stray read would be swallowed by `warm()`'s own `.catch`, so nothing would notice.
The comment states exactly that split instead of flattening it to "untested", since the flattened version is itself inaccurate.

No behavioural change: `git diff` on the file removes zero lines. Suite unchanged at 549/549.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documentation only — one comment block in `src/validate/validate-buffers.ts` at the `worthReading` declaration, added below the existing intent comment rather than replacing it. Zero lines removed, no behavioural change, no new test.

**What it records** — that `worthReading` is a performance guard and inverting it cannot change a verdict, plus the mechanism that makes that true: `warm()` only pre-warms, `scan.sources()` memoizes its promise, and impact awaits that same promise itself. A guard stuck open buys a project read nobody needed; stuck shut it moves the read from "alongside the lint" to "when impact asks". The same map is read at most once either way.

**Why** — six mutants survive on that single condition (including replacing it with both `true` and `false`, and `.some` becoming `.every`). Read cold that looks like a defence nothing observes, and the next person to run mutation testing here would otherwise re-derive the same conclusion, or "fix" a guard that is doing exactly what it should.

**On the neighbouring `--no-impact` claim** — the comment is explicit that neither claim is pinned by a test, and corrects the framing while it is there: "costs NOTHING" is two claims with different evidence. The impact adapter never being called IS asserted; the project read being skipped is not asserted anywhere, and could not be noticed if it happened, since `warm()` swallows the failure a read against the test's non-existent `projectDir` would produce.

**Verification** — `git diff` removes zero lines from the file; package suite 549/549 green and unchanged; type-check and prettier clean.
<!-- SECTION:FINAL_SUMMARY:END -->
