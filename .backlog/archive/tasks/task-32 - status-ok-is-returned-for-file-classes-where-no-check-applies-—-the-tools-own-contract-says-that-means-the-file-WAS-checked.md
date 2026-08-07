---
id: TASK-32
title: >-
  status "ok" is returned for file classes where no check applies — the tool's
  own contract says that means the file WAS checked
status: Done
assignee: []
created_date: '2026-08-01 20:13'
updated_date: '2026-08-07 12:44'
labels:
  - mcp-supervisor
  - agent-surface
  - honesty
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The server instructions draw exactly the distinction that matters:

```
ok | warning | error  -> the file WAS checked; these describe what was found.
not_applicable        -> the file was NOT checked at all. This is neither approval
                         nor refusal — it carries no opinion about the file.
```

For three YAML file-type families the lint runs and **zero checks apply**, and the answer is `ok`. Literally the file was processed; practically the agent is told a file was checked when nothing examined it.

Measured through the real pipeline. Both YAML checks early-return unless the path contains `/translations/` (`valid-html-translation/index.ts:22`, `matching-translations/index.ts:68`), so nothing at all targets:

- `CustomModelType` — `app/schema`, `custom_model_types`, `model_schemas`
- `TransactableType` — `app/transactable_types`
- `InstanceProfileType` — `app/user_profile_types`

Round 3 reported two of these three; `CustomModelType` was missed for the same reason it missed translations in TASK-21 — treating "a check targets this type" as coverage.

## Sequencing — do TASK-21 first, then re-measure

This finding's severity is almost entirely DERIVED from TASK-21. "Nothing examined this file" is alarming because the uncovered failure there is changeset-fatal. Land `YAMLSyntaxError` and all three families acquire a real, applicable check; what is left here is "checks exist and none matched", which is what `ok` legitimately means for every other file type in the system.

Widening `not_applicable` first would be the wrong order: it spends the vocabulary that means "we did not look" on precisely the class we are about to start looking at, and it would then have to be narrowed again.

So this task is deliberately blocked on TASK-21. Re-measure after it lands and decide from the residue.

## The decision, once there is a residue

Three defensible answers, and the task is to pick one and make the surface consistent with it:

1. `ok` is correct — checks ran, none objected. Then the instructions' wording is what is wrong, because "the file WAS checked" reads as a stronger claim than "was processed". Fix the prose.
2. `ok` is wrong when the applicable-check count is zero. Then a new `not_applicable_reason` is needed (`no_applicable_checks`), distinct from `unsupported_type` — the file IS a supported type, which is why it was linted at all.
3. Neither — surface the applicable-check count as data and let the agent decide.

Whichever is chosen, the tool description and `instructions.ts` must say the same thing as the code. The failure mode this whole package exists to prevent is an agent reading a clean result as a stronger claim than it is.

## Constraint

Do not weaken `must_fix_before_write`. Whatever status is returned, a file nothing objected to must not start blocking, and a merely-unexamined file must not block a batch — that invariant is already pinned in validate-code.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Re-measured AFTER TASK-21 lands: which file classes, if any, still have zero applicable checks
- [x] #2 One of the three options above is chosen explicitly, with the reasoning recorded where the code lives — not left implicit in the implementation
- [x] #3 `instructions.ts`, the tool DESCRIPTION and the returned status agree with each other; a test pins the claim so the prose cannot drift from the behaviour
- [x] #4 If a new not_applicable_reason is added, it is distinguishable from `unsupported_type` — the file IS supported, which is why it was linted
- [x] #5 `must_fix_before_write` is unchanged for every case, and a merely-unexamined file still never gates a batch
- [x] #6 All three families are covered, including CustomModelType (app/schema, custom_model_types, model_schemas), which round 3 missed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 — RE-MEASURED AFTER TASK-21, and the premise is gone. Every admitted file type is now examined by something. Measured behaviourally through the real supervisor: a deliberately broken buffer of each type, asking whether ANYTHING objected.

```
Page / Layout / Partial / Partial(lib) / Authorization / Email /
ApiCall / Sms / Migration / FormConfiguration      -> UnknownFilter        (Layout also MissingContentForLayout)
CustomModelType / CustomModelType(model_schemas) /
InstanceProfileType / TransactableType / Translation -> YAMLSyntaxError
GraphQL / GraphQL(graph_queries)                     -> GraphQLCheck

file types where nothing objected: 0
```

All 14 admitted types across 17 directory spellings. Before TASK-21 the five YAML rows were `ok`, `block=false`, zero diagnostics.

AC#2 — DECISION: option 1, `ok` is correct as it stands, and no new vocabulary is added. The reasoning is recorded in `result/assemble.ts` next to the line that computes `status`, not left implicit:

- `ok` means "checked, nothing objected", and that is now true for every admitted type;
- a `no_applicable_checks` reason would have spent the "we did not look" signal on precisely the class we had just started looking at, and would then have had to be withdrawn;
- the residual risk is an agent reading `ok` on a model schema as a SHAPE guarantee, which is a different claim and is already handled — TASK-21 added the explicit "The SHAPE of a model schema is not [checked]" sentence to the server instructions.

AC#3 — the honesty of `ok` is now an INVARIANT rather than a fact, so it is guarded as one: `validate/file-type-coverage.spec.ts`. That is the actual deliverable of this task; the status code needed no change.

AC#4 — no new `not_applicable_reason` was added, so nothing to distinguish.

AC#5 — `must_fix_before_write` is untouched. No status logic changed at all; the only edit to `assemble.ts` is a comment.

AC#6 — all three families covered, including `CustomModelType` (app/schema, model_schemas, custom_model_types), which round 3 missed. Each type's alternative directory spellings are asserted to behave identically: a type covered under `app/schema` and silent under `app/model_schemas` would still be a hole, just a harder one to see.

THE DELIVERABLE IS THE GUARD, NOT A BEHAVIOUR CHANGE — which is worth stating plainly, because a task that ends with 'nothing to fix' usually ends with nothing at all.

`validate/file-type-coverage.spec.ts` asserts that every file type this server ADMITS has at least one check that examines it, and that every type it does NOT admit is declined rather than approved. Exhaustive TWICE:

- `Record<PlatformOSFileType, Examined | typeof NOT_ADMITTED>` makes a new enum member a COMPILE error — verified by deleting an entry, which fails with TS2741 naming the missing type;
- a runtime pin repeats it with a readable message, because the compile error explains what is missing but not what to do.

This matters now rather than hypothetically: the backlog already holds TASK-2, 'Add scalar-pattern + ActivityStreams file types'. Adding a file type without a check that reads it recreates the exact defect this task was filed for, in the quietest way available — the new type would simply start answering `ok` to everything.

WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT. The per-type cases assert that a broken buffer produced at least one diagnostic — the observable proxy for 'something read this file' — and not WHICH check produced it. Which check objects is check-common's business and will change as checks are added; pinning it here would make this file fail for reasons that have nothing to do with coverage, and the predictable response to that is to weaken it.

The four YAML families are the exception and ARE pinned to `YAMLSyntaxError` exactly, because the identity of the check covering them is the substance of the fix rather than an implementation detail.

SABOTAGE-VERIFIED both halves:

| Sabotage | Result |
|---|---|
| unregister `YAMLSyntaxError` (the pre-TASK-21 world) and rebuild | 5 failures — the four YAML families plus the exact-code pin |
| delete a `PlatformOSFileType` entry from the table | compile error TS2741 naming the missing member |

The first is the one that matters: it reproduces the original defect exactly and the guard catches it, which is the only evidence that the guard would have caught it the first time.

Suites: supervisor 19 files / 341 tests green; prettier and type-check clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-measured after TASK-21, as the task required, and the premise had dissolved: ZERO admitted file types still have nothing examining them. `YAMLSyntaxError` gave the three uncovered YAML families a check, so `status: 'ok'` now genuinely means "checked, nothing objected" for all 14 admitted types across 17 directory spellings.

Decision recorded explicitly (option 1): `ok` stays, no new `not_applicable` vocabulary. Adding a `no_applicable_checks` state would have spent the "we did not look" signal on exactly the class we had just started looking at. The reasoning lives in `assemble.ts` beside the line that computes the status, so the next reader finds it where the decision is implemented.

The deliverable is therefore a GUARD rather than a behaviour change. `validate/file-type-coverage.spec.ts` turns the honesty of `ok` from a fact into an invariant: every admitted file type must be objected to when given a broken buffer, every non-admitted one must be declined, and the table is exhaustive over `PlatformOSFileType` at both compile time and runtime. The backlog already contains work to add file types, and adding one without a check that reads it would have recreated this defect silently — the new type would simply start answering `ok` to everything.

Sabotage-verified by unregistering `YAMLSyntaxError` and rebuilding: five failures, reproducing the original defect and catching it.
<!-- SECTION:FINAL_SUMMARY:END -->
