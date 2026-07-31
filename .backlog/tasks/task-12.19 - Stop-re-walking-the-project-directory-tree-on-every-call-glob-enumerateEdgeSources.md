---
id: TASK-12.19
title: >-
  Stop re-walking the project directory tree on every call (glob +
  enumerateEdgeSources)
status: To Do
assignee: []
created_date: '2026-07-30 19:08'
updated_date: '2026-07-31 09:45'
labels:
  - performance
  - check-node
  - supervisor
dependencies: []
parent_task_id: TASK-12
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-12.8 (lazy parse) and TASK-12.16 (isIgnored memoization), a warm `validate_code` is 0.6–0.7 s and what remains is two independent directory scans, each repeated on every single call:

```
lint:  glob project (1686 paths)                        89–135 ms
lint:  1686 x fileFingerprint (getApp gate)                 44 ms
graph: enumerateEdgeSources walk (GraphCache.lookup)        96 ms
graph: 1357 x fileFingerprint                               46 ms
lint:  isIgnored x 1686 (residual, genuine matching)         49 ms
loadConfig                                                  32 ms
warm lintBuffer total                                     ~370 ms
```

Neither scan is caching anything: `getApp` re-globs the whole tree, and `GraphCache.lookup` re-walks the edge-source roots to compute its fingerprint, on every request. For an unchanged project both produce byte-identical output every time. Parsing no longer contributes at all, so these two are now the warm path.

Note the stats are NOT the problem (44 + 46 ms for ~3000 of them) — it is the tree walks plus the per-call re-derivation.

APPROACH — the two scans have different owners and different invalidation needs, so treat them as one task with two parts but do not share a cache blindly:
1. `getApp`'s glob: cache the enumerated path list, invalidated when the tree changes.
2. `GraphCache`'s `computeFingerprintFromDisk`: same walk over the platformOS source roots, for the edge-source subset.

Two invalidation strategies are worth costing before choosing:
- **Directory mtime**: stat the directories rather than walking them; a changed directory mtime means its entries changed. Cheaper than a full walk, still O(dirs) — 1458 readdirs today suggests a comparable number of dirs, so measure before assuming it wins.
- **A filesystem watcher** feeding an invalidation set. Removes the per-call cost almost entirely, but adds a long-lived resource to the server, needs a bounded fallback when watches fail or hit OS limits (inotify limits on large trees), and must not leak across `shutdown`. The supervisor already has a clean shutdown path to hook.

Correctness is the whole risk: a stale listing means a newly created partial is invisible to `MissingPartial`, or a deleted one still resolves. The end-to-end invalidation loop already in `stdio-smoke.spec.ts` (missing → created → edited → deleted) is the shape to extend, and it must keep passing without any cache-clearing call.

Worth noting the ceiling: even at zero for both scans, the warm call has ~150 ms of genuine work (config load, the buffer's own parse and checks, impact assembly). Sub-100 ms is not on the table without attacking those.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both scans measured before/after (glob, enumerateEdgeSources, and their stat counts), and the warm validate_code latency recorded end to end
- [ ] #2 An invalidation strategy is chosen with measurements behind it — directory-mtime vs watcher — rather than by assumption, and the rejected option's cost is recorded
- [ ] #3 A newly created, edited, renamed and deleted file are all reflected on the NEXT call with no cache-clearing step, asserted end to end (extend the existing stdio-smoke invalidation loop)
- [ ] #4 An ignore-status change (editing .platformos-check.yml) is reflected without a file fingerprint moving — the case that catches listing caches keyed only on files
- [ ] #5 If a watcher is used: it is torn down on shutdown with no leaked handles, and there is a bounded fallback when watches cannot be established (OS limits, network filesystems)
- [ ] #6 Offense output byte-identical on three real projects, and the graph's dependents unchanged
- [ ] #7 Peak RSS does not regress — a cached listing plus a watcher must not trade latency for memory
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Re-measured 2026-07-31 — the premise was partly wrong, value is ~1/3 of what this task claimed

Profiled on an idle box (load 0.7–1.1) against `pos-module-mcp`, after TASK-12.8/12.16:

```
validate_code warm median      332–346 ms   (min 263, cold first call ~800)
  lintBuffer TOTAL             213 ms
    getApp                     120 ms   <- glob 61 ms, isIgnored 49 ms
    loadConfig                  10 ms
    buffer lint + docDefs      ~84 ms
  enumerateEdgeSources        ~142 ms   <- runs CONCURRENTLY with the 213 ms lint
not_applicable short-circuit     1 ms
```

**The two scans are NOT additive.** This task costed them as `89–135 ms + ~142 ms ≈ 230 ms` of the warm call. But lint and impact are two branches of the same `Promise.all`: `enumerateEdgeSources` sits on the impact branch, entirely hidden behind the 213 ms lint branch. Removing it saves approximately **zero** wall-clock unless it grows past the lint.

So the real prize is the glob alone: **~61 ms of a ~332 ms call (~18%)**, not 230 ms.

## Rejected approach: push `ignore` down into glob

The project globs 1686 paths and discards 90% via `isIgnored` (162 survive). Passing the config's ignore list to `glob({ ignore })` looked like it should prune whole subtrees. Measured:

```
glob (current, no ignore)     60.8 ms -> 1686 paths
glob (ignore pushed down)    126.3 ms ->  208 paths
```

**Twice as slow.** glob applies string `ignore` patterns as per-entry matching after traversal, not as directory pruning — it still walks everything and then pays minimatch on top. Pruning would need glob's `Ignore` interface with `childrenIgnored`, which is a bigger change for a sub-61 ms ceiling.

## Recommendation: deprioritized to Low

At ~61 ms available and a watcher/directory-mtime scheme trading never-stale guarantees for it, the risk/reward is poor. `loadConfig` (10 ms) is a cheaper unrelated win if anything here is wanted. Prefer the batch/multi-file API instead: an agent validating 20 files currently pays 20 × 332 ms and re-globs 20 times, which is a far larger real-world cost than one call's glob.
<!-- SECTION:NOTES:END -->
