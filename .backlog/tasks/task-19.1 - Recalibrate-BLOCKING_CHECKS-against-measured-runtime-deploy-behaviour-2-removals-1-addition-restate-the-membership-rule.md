---
id: TASK-19.1
title: >-
  Recalibrate BLOCKING_CHECKS against measured runtime + deploy behaviour (2
  removals, 1 addition, restate the membership rule)
status: In Progress
assignee: []
created_date: '2026-08-01 02:58'
updated_date: '2026-08-01 03:44'
labels:
  - bug
  - mcp-supervisor
  - correctness
  - agent-surface
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.spec.ts
  - >-
    .backlog/tasks/task-19 -
    must_fix_before_write-blocks-on-non-blocking-findings-—-dead-arguments-gate-the-write.md
parent_task_id: TASK-19
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

An external evaluation (443 cases over a live instance `fk-docs.ps-01-platformos.com`, supervisor 0.0.1) measured every member of `BLOCKING_CHECKS` against what the code ACTUALLY does at runtime and on deploy. The set is wrong in both directions, and its stated membership rule does not describe several of its own members.

Crucially, the evaluation established by differential oracle that the diagnostics themselves are correct: 51/51 diagnostics matched a `check()` run over a temp project with the buffer written to disk, positions included. In every case below the check fires with the right message at the right position — only the verdict drawn from it is wrong. This is a pure gate-calibration defect, entirely inside `blocking.ts`.

## What was measured

**REMOVE — blocks, but the file works.**

- `MissingAsset` (F-10). `{{ 'no_such.css' | asset_url }}` — `asset_url` is pure string construction. It never resolves, never raises; even `'' | asset_url` returns a URL. Instance rendered HTTP 200 with the link tag present, `pos-cli --dry-run` accepted. The asset 404s in the browser; the page is fine. Per `blocking.ts`'s own rule this is "degraded-but-working", which the rule places explicitly OUTSIDE the set. It also misfires on assets that exist on the instance but not in the local tree.
- `ReservedVariableName` (F-11). Filed under "Runtime errors on execution"; it does not error. `{% assign blank = 'oops' %}{{ blank }}` renders `[]`, `{% assign true = 'oops' %}` renders `[true]`, deployed page HTTP 200. The code is certainly wrong and worth reporting loudly, but it is the same "visibly wrong, still a working page" class the rule already assigns to `TranslationKeyExists`, which is non-blocking.

**ADD — passes, but the file is fatal.**

- `JsonLiteralQuoteStyle` (F-04). Currently listed in the "no runtime effect" comment block. `{% assign o = {'k': 'v'} %}` raises `Liquid syntax error: Invalid JSON in assign: expected ':', got '''`, and `pos-cli --dry-run` REJECTS the whole deploy. Array literals behave identically. This is the clearest case in the evaluation: the check fires correctly and the gate waves it through, and the failure is deploy-wide rather than per-page.

**KEEP, but the rule must stop lying (F-12).**

`MissingRenderPartialArguments` and `MissingContentForLayout` are deliberate policy exceptions, and the evaluation confirms neither meets the stated criterion: `{% doc %}` blocks are inert at runtime, so a missing required argument cannot raise (deployed page HTTP 200, `a=[] b=[]`, dry-run accepted); a layout missing `content_for_layout` returns HTTP 200 with the body silently dropped. Keeping them is defensible — they catch real authoring mistakes — but the file header states the rule as "will not parse, will not render, or will raise at runtime", which they do not satisfy. Restate the rule so it covers the deliberate exceptions honestly rather than leaving a criterion two of twelve members fail.

## Additional item not in the evaluation

`InvalidHashAssignTarget` sits under the SAME "Runtime errors on execution" comment that the evaluation just disproved for `ReservedVariableName`, and was never probed. Verify it independently rather than inheriting a comment now known to be unreliable for its neighbour.

## Note on the parent task

TASK-19 AC#2 requires that "a missing partial, missing asset, unknown filter and syntax error each still yield `must_fix_before_write: true`". The `MissingAsset` half of that criterion is disproven by this evaluation and must be corrected on the parent, not silently contradicted here.

## Out of scope

Do not change check-common severities — the LSP and CLI must behave identically. This is a supervisor-owned agent-ergonomics judgement and stays in `blocking.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `MissingAsset` is not in `BLOCKING_CHECKS`; a buffer whose only error is `MissingAsset` yields `must_fix_before_write: false` while still reporting the error in `errors[]`
- [x] #2 `ReservedVariableName` is not in `BLOCKING_CHECKS`; a buffer whose only error is `ReservedVariableName` yields `must_fix_before_write: false` while still reporting the error in `errors[]`
- [x] #3 `JsonLiteralQuoteStyle` is in `BLOCKING_CHECKS`; `{% assign o = {'k': 'v'} %}` yields `must_fix_before_write: true`, and the same holds for the array-literal form
- [x] #4 The 'no runtime effect' comment block no longer lists `JsonLiteralQuoteStyle`, and the entry for it states why it blocks
- [ ] #5 `InvalidHashAssignTarget` is independently verified against a live instance and either kept with evidence recorded or removed; it is no longer justified only by the shared 'Runtime errors on execution' comment
- [x] #6 The membership rule in the file header is restated so it honestly covers `MissingRenderPartialArguments` and `MissingContentForLayout`, naming them as deliberate exceptions with their criterion, rather than asserting a runtime-failure rule they do not meet
- [x] #7 `status` is unchanged by every case above — a removed-from-blocking check still produces `status: 'error'`; the gate and the status remain separate signals
- [x] #8 An unknown/unrecognized check code still defaults to NON-blocking, asserted explicitly
- [x] #9 Each of the four verdict changes is verified end to end against the real server, not only in unit tests
- [x] #10 TASK-19 AC#2 is corrected so it no longer requires `MissingAsset` to block
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed

Set went 12 -> 11 entries: removed `MissingAsset` and `ReservedVariableName`, added `JsonLiteralQuoteStyle`.

Each change carries its measurement in the code, not a plausible-sounding rationale — that is what produced the wrong entries in the first place. The header now says so explicitly: "MEMBERSHIP IS ESTABLISHED BY MEASUREMENT, NOT BY READING THE CHECK'S NAME."

## Membership rule restated (AC#6)

The old rule ("will not parse, will not render, or will raise at runtime") was failed by two of its own members. It now has three parts:

- BLOCKING — will not parse, will raise at runtime, OR **the deploy converter rejects it**, which fails the whole changeset rather than one file. The deploy clause is new and is what `JsonLiteralQuoteStyle` needs; it also gives TASK-26 somewhere to land.
- EXCEPTION — `MissingRenderPartialArguments` and `MissingContentForLayout` block WITHOUT meeting that bar, deliberately, because the file breaks a contract its author wrote down in the repository. Each is named and argued individually where it sits in the set.
- NOT BLOCKING — everything else.

The two removals are now recorded in the "deliberately not in the set" block with their evidence, so a future edit that "restores" one has to argue with the measurement. `ValidFrontmatter` was also added there as a KNOWN GAP (not a judgement), cross-referenced to TASK-26.

## AC#5 NOT met — needs instance access

`InvalidHashAssignTarget` is still unverified. It shares the "Runtime errors on execution" justification with `ReservedVariableName`, which measurement disproved — so the shared reasoning is unreliable, not the entry.

It was KEPT rather than removed: there is no evidence either way, and removing on suspicion is the same unmeasured guess in the opposite direction. The uncertainty is now recorded on the entry itself, pointing back at this AC.

No platformOS environment is configured in this repo (`.pos` has no envs), so this could not be closed here. It needs one `liquid_exec` probe: `{% assign s = 'str' %}{% hash_assign s.k = 1 %}` — does it raise, or silently no-op?

## Verification

Unit: 34 tests in `blocking.spec.ts`, with the exact set re-pinned and each of the three corrections given its own named test. Sabotage-checked — re-adding `MissingAsset` to the set fails exactly 3 tests.

End to end against the real stdio server:

```
JsonLiteralQuoteStyle (hash literal)   status=error  must_fix=true   @1:16, @1:21
JsonLiteralQuoteStyle (array literal)  status=error  must_fix=true   @1:16, @1:20
MissingAsset                           status=error  must_fix=FALSE  @1:4
ReservedVariableName                   status=error  must_fix=FALSE  @1:11
MissingPartial   (control)             status=error  must_fix=true
UnknownFilter    (control)             status=error  must_fix=true
clean file                             status=ok     must_fix=false
```

Positions match the evaluation exactly. AC#7 is visible in that table: every de-blocked finding still reports `status: error` and still appears in `errors[]` — only the gate changed.

Full monorepo suite: 2918 passed, 1 pre-existing unrelated failure (known `fileFingerprint` full-suite flake, TASK-14).

## Parent task corrected (AC#10)

TASK-19 AC#2 required `MissingAsset` to block. Rewritten to require the opposite, with the measurement inline so the correction is not mistaken for a typo.
<!-- SECTION:NOTES:END -->
