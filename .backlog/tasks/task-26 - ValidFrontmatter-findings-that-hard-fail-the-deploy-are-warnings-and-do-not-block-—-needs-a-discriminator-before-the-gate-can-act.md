---
id: TASK-26
title: >-
  ValidFrontmatter findings that hard-fail the deploy are warnings and do not
  block — needs a discriminator before the gate can act
status: Done
assignee: []
created_date: '2026-08-01 03:00'
updated_date: '2026-08-22 19:46'
labels:
  - bug
  - mcp-supervisor
  - correctness
  - blocked
dependencies:
  - TASK-8.1
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: medium
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`ValidFrontmatter` is `Severity.WARNING` and absent from `BLOCKING_CHECKS`, but two of its three measured findings are hard deploy rejections. A deploy rejection fails the ENTIRE changeset, not just the offending page, so these are the highest-blast-radius false approvals in the evaluation.

| Buffer | validate_code | Deploy |
|---|---|---|
| `not_a_real_frontmatter_key: 1` | `warning` ValidFrontmatter @3:1 | **REJECTED** — "Unknown properties" |
| `layout: no_such_layout` | `warning` ValidFrontmatter @3:1 | **REJECTED** — "Could not find Layout" |
| `authorization_policies: [no_such]` | `warning` ValidFrontmatter @4:5 | accepted |

The check detects all three accurately and positions them correctly. Only the verdict is wrong.

## Why this cannot be fixed in the supervisor alone

All three findings share the single check code `ValidFrontmatter`, with no structured discriminator on the offence. Adding the code to `BLOCKING_CHECKS` would correctly block the first two and introduce a NEW false block on the third.

This is the identical shape `blocking.ts` already documents for `PartialCallArguments` — one code reporting two different things, no discriminator, and non-goal #2 forbidding regex over message strings to tell them apart. There the resolution was to leave it non-blocking because the blocking half was independently covered. Here it is not covered by anything.

So the supervisor cannot resolve this without either:

- a structured identifier on the offence that distinguishes the finding (the general solution — see TASK-8.1, which extends the check-common seam with typed data on `Offense`), or
- splitting `ValidFrontmatter` into distinct check codes in check-common.

Both are engine-side. This task exists to hold the supervisor-side decision and to make sure the gap is not silently inherited once a discriminator exists.

## Interim question to decide

Until a discriminator lands, is the current state — two deploy-fatal findings reported only as warnings — acceptable? A defensible interim step is to leave the gate alone but make the SEVERITY of the situation visible to the agent, given that `must_fix_before_write: false` on a changeset-killing error is the worst false-approval class the evaluation found. Decide deliberately and record the reasoning; do not leave it undecided by default.

## Related

The evaluation's broader structural point: the gate models runtime failure but not deploy-time failure, and eight of its nine confirmed false approvals are deploy-time. This task is the one instance of that class that is even partly supervisor-owned; the rest require new detection in check-common.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded on the interim state — whether two deploy-fatal findings reported only as warnings is acceptable until a discriminator exists — with its rationale
- [x] #2 Once a discriminator is available, the unknown-key and missing-layout findings yield `must_fix_before_write: true`
- [ ] #3 The `authorization_policies` finding does NOT block, verified against the instance, so the fix does not trade a false approval for a false block
- [ ] #4 `blocking.ts` records why `ValidFrontmatter` is absent from the set while it remains absent, in the same place the `PartialCallArguments` reasoning lives, so the gap is documented rather than invisible
- [ ] #5 The dependency on a structured offence discriminator is explicit, so this is not attempted with message-string matching (non-goal #2)
- [x] #6 Verified end to end against a real deploy, since the failure being modelled is deploy-time rather than runtime
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered by TASK-83.1, which split `ValidFrontmatter` into per-shape check codes. Three of the resulting codes are now in `BLOCKING_CHECKS`, so the deploy-fatal frontmatter findings answer `must_fix_before_write: true`.

**Closed on the `fix/never-rewrite-operator-expressions` branch for bookkeeping; the code that closes it is on `fix/split-valid-frontmatter-per-shape-checks`.**

## Two of this task's own premises turned out to be wrong

**The blocker was a mis-linkage.** This task was blocked on TASK-8.1, a typed `data` payload on `Offense`. TASK-8.1 answers "which SYMBOL is this diagnostic about", for rendering a docset entry — its leading candidate is `findCurrentNode`. The write gate needs "which RULE fired", a different question `findCurrentNode` cannot answer and one the repository already answers everywhere else with a check code. Doc-params are five codes, filters are four; `ValidFrontmatter` carrying seven rules was the anomaly. No seam change was needed.

**The trade-off it recorded did not exist.** The stated reason for not blocking was that adding the code would fix two false approvals and create one false block. Both halves were wrong: there were seven reachable shapes rather than three, and `layout: false` — named here as the harmless one — is itself a converter rejection (`undefined method 'sub' for false`). Its own diagnostic claimed the opposite and has been corrected.

## Criteria, honestly

- #2 and #6 met: the fatal findings block, verified end to end against a real deploy.
- #1 superseded — the gap is closed rather than deferred, so no interim decision is needed.
- #3 **INVERTED, and this is the important one.** It required that `authorization_policies` must NOT block. A real deploy rejects it — `<page> tries to assign authorization_policies which do not exist` — so it blocks. The criterion was written from `--dry-run`, which accepts that file because `base_converter.rb` returns before `bulk_write_associations_from_snapshot!`, the code that raises. The dry run's silence was never evidence.
- #4 moot: `ValidFrontmatter` no longer exists, so there is no absence left to explain.
- #5 resolved differently: per-shape check codes rather than a structured discriminator on the offense. No regex over messages anywhere, so non-goal #2 holds.

## Related

TASK-83 (parent) and TASK-83.1–83.5 carry the work and the measurements. TASK-86 and TASK-87 came out of the same real-deploy campaign.
<!-- SECTION:FINAL_SUMMARY:END -->
