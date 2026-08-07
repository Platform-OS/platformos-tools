---
id: TASK-38
title: >-
  Attribute the lint throughput regression and re-derive LINT_MS_PER_KIB from a
  controlled measurement
status: Done
assignee: []
created_date: '2026-08-02 07:11'
updated_date: '2026-08-02 15:56'
labels:
  - mcp-supervisor
  - performance
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - packages/platformos-mcp-supervisor/src/cost-model.ts
  - packages/platformos-mcp-supervisor/src/validate/batch-bounds.ts
  - packages/platformos-mcp-supervisor/scripts/measure-lint-cost.mjs
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observation

Round 4 re-measured lint throughput on the same machine and substrate as round 3, best of three:

| Probe | Round 3 | Round 4 | Change |
|---|---|---|---|
| 266 KiB batch, 4 files | 15 093 ms | 18 183 ms | +20% |
| single 128 KiB buffer | 6 233 ms | 8 783 ms | +41% |

Measured throughput is now about 68.5 ms/KiB against a modelled `LINT_MS_PER_KIB` of 75 — a 9% margin, down from roughly 24% in round 3.

## Why this is worth a task despite nothing being broken

P-01 remains closed: the worst legal batch runs 18.5 s against a 119 700 ms earned deadline. Nothing times out and nothing is at risk today.

It matters because the entire derived cap rests on that one constant. `MAX_BATCH_BYTES` is computed from it, so the cap is only meaningful while the constant is honest, and the direction of travel is toward it.

There is a second reason the number deserves explanation rather than monitoring: the constant was chosen with deliberate headroom over a measurement of 12 to 17 ms/KiB. Arriving at 68.5 means either the workload or the environment moved by roughly a factor of four, and neither has been established.

## What was NOT established

The round-4 report explicitly declined to attribute the slowdown. Candidates it named but did not isolate: the per-file async docset lookup added to `InvalidHashAssignTarget`, and the added YAML routing. It also noted the measurements came from the same machine as round 3 but not a controlled one, so part of the change may be environmental.

Attribution is the first half of this task; recalibration is only correct once the cause is known.

## Constraint

`cost-model.ts` carries an explicit instruction not to lower this constant to match a faster measurement. That rule stands. This task is about whether the constant is still an honest ceiling, which is the opposite direction and the one the rule was written to protect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The throughput change is attributed to a named cause or explicitly recorded as environmental, with the measurement that settles it
- [x] #2 LINT_MS_PER_KIB is re-derived from a controlled measurement on an otherwise idle machine, and the doc comment records the new number, the date, and the machine it came from
- [x] #3 If the constant changes, the derived MAX_BATCH_BYTES change is stated in bytes and its effect on a realistic large changeset is measured rather than assumed
- [x] #4 The existing rule that this constant is never lowered to match a faster measurement is preserved and still explained at the call site
- [x] #5 The worst legal batch is re-timed against its earned deadline, so the margin is a measured fact in the repo rather than a figure from an external report
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

**The throughput change was ENVIRONMENTAL.** `LINT_MS_PER_KIB` stays at 75.

Round 4 reported 68.5 ms/KiB and named two candidate causes without isolating either. Neither was the cause: the commit *before* the position-mapping fix, measured today with the same script on this machine, runs at **45.4 ms/KiB** — a 1.5x difference from that report with no code change at all between the two numbers. That matches round 4's own caveat that its runs were on the same machine but not a controlled one.

## The A/B that settles it

Git worktree at `af77a68^` (`55938f4`), its own `yarn install`, identical harness copied in. `require.resolve('@platformos/platformos-check-common')` was verified to land *inside* the worktree — symlinking node_modules from the main repo would have silently measured HEAD's check-common twice. `yarn.lock` unchanged between the two states; the only package.json delta is a devDependency.

Run order BASE -> HEAD -> BASE, so drift over the measurement window is visible. The two BASE runs agreed to within 1%.

| shape | BASE | HEAD | change |
|---|---|---|---|
| single 128 KiB clean | 45.4 ms/KiB | 44.2 | noise |
| single 128 KiB dense | 42.1 | **29.6** | **-29%, -1.58 s** |
| 266 KiB batch, 4 files | 36.2 | 37.1 | noise |
| 266 KiB batch, 50 files | 26.8 | 26.8 | unchanged |

Both sides produced **4 228** and **8 784** diagnostics — reproducing round 4's counts exactly, which is the evidence that the harness exercises the same workload rather than an easier one.

The position fix is real but NARROW, and buys nothing on either batch shape — and the batch shapes are what `MAX_BATCH_BYTES` is derived from, so the cap's margin was never the thing that improved.

## Two findings that were not expected

**Clean markup is the slowest shape** (50.8 ms/KiB vs 35.6 dense). Realistic markup — `{% doc %}`, loops, renders, filter chains — costs more per byte than markup that is one broken filter per line. Sizing the constant on the diagnostic-dense shape alone would under-count the common case by a third. The script measures both for this reason.

**Run-to-run spread is ~10%** on the same idle machine (clean single: 44.2, 48.4, 50.8). The recorded table is the WORST of three idle runs, each itself a best-of-three. Taking the favourable run would restate a ceiling as an average.

## Per-check attribution: attempted, failed, removed

A `--attribute` mode timed the dense shape with one check disabled at a time. It produced confident, wrong tables **three times**:

1. One baseline up front, diffed against every later run. V8's JIT warms as the process runs, so whatever ran FIRST was slowest and everything after looked like a saving. Per-check "savings" summed to ~800% of the runtime.
2. Adjacent baseline/disabled pairs, single-sample noise floor. The floor was one draw from a distribution; eleven checks landed "above" it.
3. Same, floor sampled five times: 13, 13, 1074, 139, 34 ms — a fat tail, almost certainly GC — and one check came out at 2 864 ms of a 3 786 ms lint.

The tell each time was `JSONSyntaxError` and `YAMLSyntaxError` appearing with real costs. Those are `SourceCodeType.JSON` and `SourceCodeType.YAML` checks and **cannot touch a Liquid buffer**, so any cost credited to them is a direct readout of the method's error bar — hundreds of milliseconds, against per-check effects of tens.

Wall-clock A/B does not have the resolution for this and no guarding fixes it, so the feature was **removed rather than shipped**. A plausible-looking ranking is worse than none: someone optimises against it. The full reasoning is kept in the script's header so the dead end is not walked twice. Answering "which check is hot" needs per-visitor instrumentation, not subtraction of two noisy totals.

(One correction in passing: `GraphQLVariablesCheck` is a `LiquidHtml` check, not GraphQL — it inspects `{% graphql %}` tags — so its appearance was implausible rather than impossible. The JSON/YAML pair are the valid controls.)

## Artefact

`scripts/measure-lint-cost.mjs` — builds a synthetic 40-partial project, runs the four shapes, prints the table and the margin. Not in CI: a wall-clock assertion fails on a busy runner and passes on a fast one, and the only way to stabilise it is to loosen it until it says nothing. The ARITHMETIC stays asserted in `cost-model.spec.ts`, which is hermetic and exact; this script supplies the empirical input by hand.

Guards it carries, each from a mistake made while building it:
- refuses to interpret results under load, and says so
- realistic markup rather than filler (filler validates ~3x faster and reports a comfortable number)
- counts diagnostics from `truncated.total`, not the returned arrays, which the response budget caps at ~200 for a buffer that generated 4 228
- **refuses `--project` + config rewriting outright** rather than backing up and restoring: a crash mid-run would still lose a real project's `.platformos-check.yml`, and losing someone's lint config to a benchmark is not a trade worth offering

## AC settlement

- **#1** Environmental, with the cross-commit paired measurement that settles it. The two named candidates are not resolvable above noise; recorded as unknown rather than guessed.
- **#2** Re-derived 2026-08-02 on Intel i7-6820HQ @ 2.70GHz / 8 threads / 31 GB / node v25.6.0, idle. Worst 50.8 ms/KiB. Constant, date and machine all in the doc comment.
- **#3** Zero byte change — the constant did not move, so `MAX_BATCH_BYTES` (272 384 bytes) is unchanged by construction.
- **#4** The DO-NOT-LOWER rule is preserved and now names this measurement as exactly the situation it guards against.
- **#5** Worst legal batch re-timed and recorded in `batch-bounds.ts`: 10.7 s over 4 files and 9.6 s over 50, against a 119 700 ms earned deadline (11x and 12x). Deadline verified against `lintDeadlineMs` and `maxBytesWithin` rather than derived by hand.

## Verification

Type-check clean, prettier clean, full suite green. The `ab-base` worktree was removed and pruned.
<!-- SECTION:NOTES:END -->
