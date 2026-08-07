---
id: TASK-18
title: >-
  validate_code returns ok for config-ignored files — a false pass of the same
  class as the off-project bug
status: Done
assignee: []
created_date: '2026-07-31 11:19'
updated_date: '2026-07-31 11:20'
labels:
  - bug
  - mcp-supervisor
  - correctness
dependencies: []
modified_files:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/ignored-by-config.spec.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-files.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-files.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Found while auditing the TASK-13/15/17 work. `check()` skips config-ignored files **silently**, so a caller that lints one buffer and sees no offenses cannot tell "clean" from "never checked". `validate_code` reported the latter as `ok`.

Reproduced against the real build on `pos-module-mcp`, whose `.platformos-check.yml` ignores `app/views/pages/**`. Buffer content is deliberately unparseable Liquid (`{% if %}{{ unclosed`), so a real check would have plenty to say:

```
app/views/pages/ignored_probe.liquid            | ok    | must_fix: false | errs: 0
app/views/partials/mcp/not_ignored_probe.liquid | error | must_fix: true  | errs: 1
```

Identical content, identical brokenness — one reported as validated-and-clean purely because of the ignore list.

This is **exactly the false-approval class TASK-13 fixed for off-project and unsupported-type paths**, and it was left open: the write gate saying "validated, safe to write" about a file nothing looked at. Worse than the off-project case in one respect — an ignored file is usually a file the agent legitimately wants to write, so the wrong answer is actually acted upon.

## Fix

New `NotApplicableReason` value `ignored`, reported for any requested file the project's `ignore` list excludes.

- `ignoredByConfig(root, filePaths, configPath?)` in check-node — one config load answers the whole list, returning the caller's own strings.
- Both tools consult it AFTER the pure applicability gate (so an off-project path never triggers a config load) and BEFORE linting, and drop ignored files from the lint entirely, since `check()` would skip them anyway.
- Only the **global** `ignore` list counts. A per-check `settings.<Check>.ignore` means the file is still checked, just by fewer checks; treating that as "not checked" would be wrong in the other direction.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An ignored file returns `not_applicable` / `ignored`, never `ok`, with `must_fix_before_write: false`
- [x] #2 Verified with unparseable content, so the empty result provably came from the ignore list and not from the checks having nothing to say
- [x] #3 A non-ignored file with the same content still reports its errors (proves the test is not vacuous)
- [x] #4 Only the global ignore list triggers it; a per-check ignore does not
- [x] #5 An ignored file is not sent to the lint at all
- [x] #6 The config is consulted once per batch, and never for a file the pure gate already declined
- [x] #7 Ignore status is decided from the pattern, not from file existence (buffers are frequently unsaved)
- [x] #8 A spec correlates the two directly: what `ignoredByConfig` reports and what the lint actually skips must agree
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## How it was found

Not from a report — from auditing my own just-"validated" TASK-13/15/17 work for remaining false-pass paths. TASK-13 closed the off-project and unsupported-type cases and I had treated that area as done; the config-ignore path was the same hole left open one layer down, and it is the one an agent actually hits, because an ignored file is usually a file it legitimately wants to write.

## Fix

`ignoredByConfig(root, filePaths, configPath?)` in check-node. One config load answers a whole list and returns the caller's own strings, so a batch pays it once.

Both handlers consult it **after** the pure applicability gate and **before** linting:

- after, so an off-project path never triggers a config load (asserted: `never asks the config about a file already declined by the pure gate`), and so the more actionable "outside the project" reason wins when both apply;
- before, and ignored files are dropped from the lint entirely, since `check()` would silently skip them anyway.

Injected as a third adapter (`Partial<Adapters>` with defaults) so orchestration unit specs stub it — necessary as well as tidy: under fake timers, real config I/O never settles, which surfaced as six hanging specs before I stubbed it.

Only the **global** `ignore` list counts. A per-check `settings.<Check>.ignore` leaves the file checked by other checks, so calling that "not checked" would be wrong in the opposite direction.

## Verified end to end, before and after

```
BEFORE  app/views/pages/ignored_probe.liquid  | ok              | must_fix: false | errs: 0
AFTER   app/views/pages/ignored_probe.liquid  | not_applicable  | must_fix: false | reason: ignored
        app/views/partials/mcp/not_ignored…   | error           | must_fix: true  | errs: 1
```

Both probes carry identical unparseable content (`{% if %}{{ unclosed`). The second is the control: it proves the empty result came from the ignore list, not from the checks having nothing to say.

## Test discipline

16 new specs (8 in check-node for the helper, 8 across the two handlers). Sabotaged the guard in both handlers → **7 of 7** ignore-specific specs fail.

The load-bearing spec is the correlation one: `ignoredByConfig` and the lint must agree about the same file, with a non-ignored control alongside. If those two ever drift, the supervisor either reports a false pass or refuses a file it could have checked — so the invariant is pinned directly rather than inferred.

Also covered: ignore decided from the PATTERN not from file existence (supervisor buffers are frequently unsaved), absolute and relative `file_path` reaching the same decision, and one config consultation per batch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A config-ignored file no longer reports `ok`. It returns `not_applicable` with reason `ignored`, `must_fix_before_write: false`, and prose stating plainly that nothing was checked.

`check()` skips ignored files silently, so "no offenses" for one meant "never looked at" — and `validate_code` presented that as validated-and-clean. Same false-approval class as the `/etc/shadow` bug TASK-13 fixed, but more consequential: an ignored file is typically one the agent means to write, so the wrong answer gets acted on. Proven with unparseable content plus a non-ignored control carrying identical content.

Fixed via a new `ignoredByConfig` helper in check-node, consulted by both tools after the pure gate (so a refused path never loads config) and before the lint (ignored files are dropped from it). Only the global ignore list counts; a per-check ignore leaves the file checked. 16 new specs, guard sabotage-tested in both handlers (7/7 fail without it).
<!-- SECTION:FINAL_SUMMARY:END -->
