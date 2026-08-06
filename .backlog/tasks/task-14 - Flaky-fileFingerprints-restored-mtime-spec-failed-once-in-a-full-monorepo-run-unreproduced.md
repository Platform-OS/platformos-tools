---
id: TASK-14
title: >-
  fileFingerprint's restored-mtime spec asserted a guarantee stat cannot make —
  not a flake
status: Done
assignee: []
created_date: '2026-07-30 21:18'
updated_date: '2026-08-01 12:59'
labels:
  - platformos-check-node
  - correctness
  - test-infra
dependencies: []
modified_files:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/file-fingerprint.spec.ts
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

## Resolved — and it was not a flake

It failed again on Windows CI (node 24), which finally made it cheap to diagnose properly rather than by re-running.

### The measurement the earlier investigation was missing

The earlier probe was right and its conclusion was wrong. Re-measured on ext4, 200 back-to-back rewrites of the exact test sequence:

```
ctime IDENTICAL (fingerprint blind) : 138 / 200   (69%)
smallest non-zero ctime delta       : ~1 ms
```

And critically, nanosecond stats do NOT help:

```
identical with ctimeMs (current impl) : 141 / 200
identical with ctimeNs ({bigint:true}): 141 / 200
smallest non-zero ctimeNs delta       : 999998 ns
```

The kernel coarsens the stored timestamp to the tick, so `ctimeNs` shows the same ~1 ms floor. **No stat-based fingerprint can distinguish two changes inside one tick.**

### What the test was really reporting

The doc on `fileFingerprint` claimed "content that changed ALWAYS yields a different fingerprint". That is false, and the test asserted it. So the test failed ~69% of the time at microsecond timescale against a perfectly correct implementation — it passed only when timing happened to help, which is why it looked like load-dependent flakiness and why it got written off as "a known flake" (including by me, twice).

A test that fails most of the time against correct code is noise, and noise is worse than no test: it trains everyone to ignore it.

### Fixes

1. **The doc's guarantee is corrected**, with the measured numbers. The honest contract: a change is detected UNLESS it lands in the same timestamp tick AND keeps the byte length AND restores the mtime — all three must coincide. Closing that window would mean hashing content, i.e. reading every file on every call, which is the cost `AppCache` exists to avoid.
2. **The test separates the two changes into different ticks** via `awaitFilesystemTick`, which POLLS rather than sleeping a fixed amount, so it also holds on coarse filesystems (1 s NFS, 2 s FAT). That removes the confound and leaves the assertion the test exists for.
3. **The bound is pinned rather than hidden** by a new deterministic test asserting the fingerprint is exactly `mtimeMs:ctimeMs:size` — which makes what it can and cannot discriminate legible at a glance.
4. The `AppCache` integration test got the same tick separation. It passed before only because the lint between writes takes far longer than a tick — luck, not a property.

### Verification

Stable 5/5 standalone and 3/3 after restore. Sabotage-checked: dropping `ctimeMs` from the fingerprint fails 3 tests, including the reworked one — so it still bites for the regression it was written to catch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Not a flake. `fileFingerprint`'s doc claimed a changed file "always" yields a different fingerprint; the spec asserted that, and it is not true. Discrimination rests on `ctimeMs`, which is only as fine as the filesystem's timestamp clock — measured at ~1 ms on ext4, with 69% of back-to-back same-length rewrites producing an identical value. Nanosecond stats give no improvement, because the kernel coarsens the stored timestamp. So no stat-based fingerprint can separate two changes inside one tick.

The test was therefore failing against correct code most of the time and passing only when timing helped, which made it look load-dependent and got it dismissed as flaky across three separate sightings.

Fixed by correcting the overclaiming doc to state the real bound (a change is missed only if it shares a timestamp tick AND keeps its byte length AND restores the mtime — all three), separating the two writes into different ticks with a polling helper that also works on coarse filesystems, and adding a deterministic test that pins the fingerprint's composition so the bound is visible rather than lurking. The `AppCache` integration test got the same treatment, since it was passing only because lint work happens to exceed a tick.

Sabotage-verified: removing `ctimeMs` still fails three tests, so the guard the spec exists for is intact.
<!-- SECTION:FINAL_SUMMARY:END -->
