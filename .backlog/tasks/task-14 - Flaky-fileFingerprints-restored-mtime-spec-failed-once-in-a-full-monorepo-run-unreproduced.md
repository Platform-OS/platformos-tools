---
id: TASK-14
title: >-
  Flaky: fileFingerprint's restored-mtime spec failed once in a full-monorepo
  run (unreproduced)
status: To Do
assignee: []
created_date: '2026-07-30 21:18'
updated_date: '2026-07-31 12:30'
labels:
  - flaky-test
  - platformos-check-node
  - test-infra
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observation

During a full `yarn test` run, one test failed:

```
FAIL packages/platformos-check-node/src/file-fingerprint.spec.ts
  > Unit: fileFingerprint
  > changes when content of the same length is written under a restored mtime
Test Files  1 failed | 296 passed (297)
Tests  1 failed | 2740 passed (2741)
```

## Reproduction attempts — all green

| attempt | result |
|---|---|
| spec alone | 25/25 pass |
| full `platformos-check-node` suite | 122/122 pass |
| full `yarn test` (twice more) | 2741/2741 pass both times |

So it is **not reproducible on demand**. Do not treat the mechanism below as confirmed.

## Plausible mechanism (evidence, not conclusion)

`fileFingerprint` is `` `${mtimeMs}:${ctimeMs}:${size}` ``. The test pins mtime and keeps size constant, so the assertion `after !== before` rests entirely on **ctimeMs differing between two `utimes` calls**.

A synthetic probe of that exact sequence (`writeFile` → `utimes` → `stat` → `writeFile` → `utimes` → `stat`) on this machine:

```
identical ctimeMs in 161/200 iterations (80.5%)
```

So sub-millisecond ctime collisions are common in a tight loop. That makes a latent timing dependency plausible. **But it does not explain the observation** — if the test were exposed to an 80% collision rate it would fail constantly, and it passes 25/25. Something about the real test (temp-workspace setup, vitest async overhead between the two `utimes`) evidently separates them. The gap between the probe and the test is unexplained and is the thing to investigate.

## Why not just add a delay

Inserting a `sleep` would probably make it pass, but on an unconfirmed diagnosis it would mask rather than fix, and the sequence already passes 25/25 — so a delay would be untestable belt-and-braces. Diagnose before changing.

## Suggested investigation

1. Instrument the spec to log both `ctimeMs` values and the elapsed time between the two `utimes`, then run it inside a full `yarn test` (not standalone) until it reproduces — the full run is the only context that has ever failed.
2. Check whether the failure correlates with which spec file ran immediately before, and with machine load (this run was on an otherwise-busy box).
3. If ctime collision IS confirmed as the cause, prefer making the fingerprint's *contract* robust over making the test sleep — e.g. include a content hash for small files, or assert the precondition (`ctime changed`) explicitly so a collision reports as a skipped precondition rather than a false failure.
4. Note that `AppCache` invalidation correctness itself is separately covered by the two `Integration: AppCache invalidation for a forged mtime` specs in the same file, which did not fail.

## Context

Introduced with the `ctimeMs` component of `fileFingerprint` (TASK-12 line of work), which closed a real stale-cache false positive: an equal-length `{% doc %}` edit under a restored mtime used to leave `AppCache` serving the previous parse. The guarded behaviour is correct and worth keeping — only the test's determinism is in question.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Second occurrence, 2026-07-31 — pattern is now clearer

Failed again in a full `yarn test` run:

```
Test Files  1 failed | 304 passed (305)
Tests  1 failed | 2908 passed (2909)
FAIL packages/platformos-check-node/src/file-fingerprint.spec.ts
```

Running tally across this session:

| context | result |
|---|---|
| spec alone | 25/25 pass |
| check-node suite alone | pass (several runs) |
| full `yarn test` | **2 failures**, 3 passes |

The correlation is now strong enough to state: it fails ONLY in full-monorepo runs, never in isolation. That points at load/concurrency rather than anything in the spec's own logic — consistent with the ctime-collision hypothesis (a busy machine makes the two `utimes` calls land closer together), but still not proof.

Investigation guidance unchanged: instrument the spec to log both `ctimeMs` values and the elapsed time between the two `utimes`, then run it inside a full `yarn test` until it reproduces. The full run is the only context that has ever failed, so reproducing standalone is not the goal.
<!-- SECTION:NOTES:END -->
