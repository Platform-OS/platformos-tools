---
id: TASK-32
title: >-
  status "ok" is returned for file classes where no check applies — the tool's
  own contract says that means the file WAS checked
status: To Do
assignee: []
created_date: '2026-08-01 20:13'
labels:
  - mcp-supervisor
  - agent-surface
  - honesty
dependencies:
  - TASK-21
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
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
- [ ] #1 Re-measured AFTER TASK-21 lands: which file classes, if any, still have zero applicable checks
- [ ] #2 One of the three options above is chosen explicitly, with the reasoning recorded where the code lives — not left implicit in the implementation
- [ ] #3 `instructions.ts`, the tool DESCRIPTION and the returned status agree with each other; a test pins the claim so the prose cannot drift from the behaviour
- [ ] #4 If a new not_applicable_reason is added, it is distinguishable from `unsupported_type` — the file IS supported, which is why it was linted
- [ ] #5 `must_fix_before_write` is unchanged for every case, and a merely-unexamined file still never gates a batch
- [ ] #6 All three families are covered, including CustomModelType (app/schema, custom_model_types, model_schemas), which round 3 missed
<!-- AC:END -->
