---
id: TASK-12.20
title: Remove three measured per-run overheads from the lint hot path
status: Done
assignee: []
created_date: '2026-08-19 10:46'
updated_date: '2026-08-19 11:22'
labels:
  - performance
  - check-common
  - check-node
  - platformos-common
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A whole-project lint of a real 1509-file project (~10.2 s, 454 offenses) spends ~1.1 s on overhead rather than analysis, and throws away its first read's parses. The parser itself is out of scope here (TASK-12.18 covers it).

Measured: isIgnored costs 805 ms across 49,932 calls, because it is asked per (file, check) and re-evaluates the same global ignore patterns for all 39 liquid checks of every file. findNearestKeys costs 362 ms for SEVEN suggestions, because levenshtein allocates a fresh matrix per candidate key. And warm-up takes TWO whole-project runs rather than one, because the freshness baseline is recorded on the first revalidation after a read instead of at read time, so the second run invalidates and re-parses everything the first read (12980 / 11094 / 4119 / 3846 ms over four runs in one process; 863 / 652 / 112 ms for a single-buffer lint). MAX_RETAINED_FILES = 200 then evicts most of what survives.

Simulated fixes gave 805 -> 43 ms and 362 -> 20 ms with byte-identical offense output. A stat costs 21 us/file, so recording the baseline at read time costs ~20 ms for 941 files against ~7 s of discarded parses. Retaining a whole project costs ~33 KB/file (+21 MB here, 217 MB on a 6027-file project), so a cap must stay, but 200 is far below what it can afford.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 isIgnored answers the global ignore patterns once per file instead of once per (file, check), and compiles no more matchers than before
- [x] #2 findNearestKeys and levenshtein return identical results while allocating no per-candidate matrix, and levenshtein's exported signature is unchanged for platformos-graph
- [x] #3 A file records the freshness baseline observed BEFORE its own read, so the first revalidation after a read keeps the file instead of invalidating it
- [x] #4 The recorded baseline can never describe a state newer than the content held, so a write landing between the stat and the read still forces a re-read
- [x] #5 MAX_RETAINED_FILES is raised to 10000 and its doc comment carries the measured per-file retention cost
- [x] #6 A repeated whole-project lint in one process is warm on the SECOND call, asserted as a test rather than only measured
- [x] #7 Offense output on a real project is unchanged (count and per-offense check plus position) before and after the whole change
- [x] #8 Existing ignore.spec, shared-app.spec, App.spec and fingerprints.spec expectations are updated where the change makes them wrong, and each new behaviour has a control that must still fire
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Four changes, each measured against a baseline captured on HEAD with the SAME check set.

check-common/src/ignore.ts — global patterns are compiled and matched once per file (`globalVerdictByConfig`, a per-config Map keyed on the subject as the caller spelled it, so the `uriFromPathOrUri` conversion is skipped on a hit); per-check patterns are compiled alone and consulted only when a check declares any. `hasIgnorePatterns` ORs the two halves, preserving its check-less/per-check asymmetry.

check-common/src/utils/levenshtein.ts — two reused rows instead of an (a+1)x(b+1) matrix per call; `findNearestKeys` rejects candidates on length difference before the O(n*m) comparison (a length gap is a lower bound on the distance). Exported signature unchanged for platformos-graph.

platformos-common/src/app/AppFile.ts — `load()` stats before it reads and keeps the result as `loadedStat`. Order is a correctness property: taken before, the worst case is a baseline older than the content, which fails the next comparison and re-reads; taken after, it could describe a write that landed during the read and pair it with older content. Cleared by `setSource` and `invalidate`.

check-node — `revalidateLoaded` seeds its baseline from `file.loadedStat` via a new `fingerprintOfStat` (so the format has one spelling), and `MAX_RETAINED_FILES` is 200 -> 10000.

MEASURED (pos-module-community, 1509 files, 454 offenses):
- isIgnored 849 -> 55 ms over the same 51,201 calls
- findNearestKeys 374 -> 23 ms over the same 7 calls
- four lints in one process: 13558/11513/8666/9869 -> 13359/3449/3271/3245 ms — warm on the second call, and 3.9x faster warm
- single-buffer lintBuffer, same file three times: 863/652/112 -> 843/110/113 ms
- pre-read stat costs 37 ms on a 122 ms read phase (best of 6 interleaved rounds). The old comment's "+25% on whole-project commands" is right as a fraction of the READ PHASE and wrong as a fraction of a lint: 122 ms of ~10 s.
- retention: ~33 KB/file, so the whole 1509-file project costs +21 MB of heap; a 6027-file project +200 MB. Revalidation's stat sweep is ~21 us/file, so a fully-retained 10000-file project would add ~200 ms per call.

VERIFICATION
- Offense output byte-identical (uri, check, severity, start, end, message; sorted) on pos-module-community (454) and calories (149), against a baseline rebuilt on HEAD.
- isIgnored differential against the previous implementation inlined as an oracle: 0 disagreements over 67,770 (file, check) pairs, 25,290 ignored under both. calories is the zero-pattern control (0 ignored, exercises the early return).
- levenshtein differential against the old matrix implementation over every pair of a 15-word spanning set: 0 disagreements.
- Sabotage: length pre-filter `>` -> `>=` fails 1; returning the wrong DP row fails 4; global memo keyed without the file fails 3; per-check patterns never consulted fails 8; read capturing no stat fails the shared-app retention test; stat taken after the read fails App.spec's order assertion.
- 344 test files / 4257 tests pass. pos-cli check run end-to-end unchanged.

TWO TRAPS HIT
1. The session's first baseline was captured against a stale dist predating commit c0907ab, which adds a 39th liquid check — visible as isIgnored calls jumping 49,932 -> 51,201 (exactly one per liquid file) and NOT as an offense difference, since that check reports nothing on these projects. Every number above was re-taken after rebuilding HEAD.
2. The eviction test's read count stayed at 2 for a DIFFERENT reason: the second read used to be revalidation's rebaseline and is now eviction (card is read first, so it holds the lowest lastTouch in an over-cap project). Verified with a probe, and the comment now states the cause rather than the number.

CONSEQUENCE OF THE BUMP: shared-app.spec derives its over-cap project from MAX_RETAINED_FILES, so it now materializes 10,020 temp files and takes ~6.7 s (writes are already parallel). Faithful to the real cap, but it scales with any further raise; making the cap injectable would be the alternative.

DOCS: packages/platformos-check-node/CLAUDE.md and packages/platformos-common/CLAUDE.md both described the old revalidation order and are updated, including the corrected denominator for the +25% figure.

NOT DONE (separate concerns): the parser is untouched — TASK-12.18 owns the {% liquid %} statement re-parse, and its parameterized-rule memo-miss diagnosis is the mechanism behind what a density measurement here showed only as a per-construct constant factor. Nothing in-process currently does repeated whole-project lints except `pos-cli check run -a`, so the raised cap mostly buys headroom rather than a win today.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed all four changes; 344 test files / 4257 tests pass, formatting clean, `pos-cli check run` unchanged end to end.

Results on pos-module-community (1509 files, 454 offenses), against a baseline rebuilt on the same commit so the check set matches:

| | before | after |
|---|---|---|
| isIgnored (51,201 calls) | 849 ms | 55 ms |
| findNearestKeys (7 calls) | 374 ms | 23 ms |
| four lints, one process | 13558 / 11513 / 8666 / 9869 ms | 13359 / 3449 / 3271 / 3245 ms |
| single-buffer lint x3 | 863 / 652 / 112 ms | 843 / 110 / 113 ms |

Warm arrives on the second call rather than the third, and a warm whole-project lint is 3.9x faster than a cold one. Offense output byte-identical on two real projects.

Correctness rests on differentials rather than on reasoning: the previous isIgnored agrees on all 67,770 (file, check) pairs of that project, and the previous levenshtein on every pair of a spanning set. Six deliberate sabotages each fail a test.

Files: check-common/src/ignore.ts + spec, check-common/src/utils/levenshtein.ts + new spec, platformos-common/src/app/AppFile.ts + App.spec, check-node/src/fingerprints.ts, check-node/src/shared-app.ts + spec, both package CLAUDE.md files, and .changeset/lint-stops-paying-for-bookkeeping.md. Left uncommitted for review.

Two things a reviewer should not have to rediscover: the "+25% on whole-project commands" figure that justified the old revalidation order is right as a fraction of the read phase (122 ms) and wrong as a fraction of a lint, and the eviction test's read count of 2 now has a different cause (eviction, not rebaseline) which its comment now states. Raising the cap also made shared-app.spec materialize 10,020 temp files, ~6.7 s.
<!-- SECTION:FINAL_SUMMARY:END -->
