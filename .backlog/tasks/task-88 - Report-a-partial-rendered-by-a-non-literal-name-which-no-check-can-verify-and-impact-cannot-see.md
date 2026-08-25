---
id: TASK-88
title: >-
  Report a partial rendered by a non-literal name, which no check can verify and
  impact cannot see
status: To Do
assignee: []
created_date: '2026-08-24 12:15'
labels:
  - check-common
  - mcp-supervisor
  - false-approval
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - packages/platformos-check-common/src/checks/missing-partial/
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: medium
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A `{% render %}` / `{% include %}` / `{% function %}` whose partial name comes from a VARIABLE rather than a string literal is invisible to the whole toolchain, and the toolchain currently reports that invisibility as "fine".

MEASURED on a live instance (fk-docs.ps-01-platformos.com, 2026-08-24) — the runtime resolves the variable and looks the partial up by its VALUE:

    {% assign random_string = 12 | random_string %}[{{ random_string }}]
    => [0574a0942c82]

    {% assign random_string = 12 | random_string %}A{% include random_string %}B
    => Liquid error (line 1): can't find partial "f36f9426e925".

`validate_code` answers `status: ok`, `must_fix_before_write: false`, no errors/warnings/infos, for that second buffer. Two separate silences produce it, and each is individually correct:

- `MissingPartial` resolves LITERAL names only, so it has nothing to resolve and says nothing.
- `DeprecatedTag` is right to stay quiet: `include` carries `deprecated: false` in the shipped `tags.json`.

The gap is that "unverifiable" and "verified fine" come back identical on the wire.

THE SECOND HALF, in platformos-mcp-supervisor. Every edge platformos-graph records names its target with a static string literal, so a dynamic name synthesizes NO edge. A partial that is only ever rendered dynamically therefore reports `impact.dependents.total: 0` with `status: computed` — which reads as "nothing depends on this, safe to change" and is false. `impact.ts`'s own docblock states the static-literal premise; what is missing is the consequence being stated where an agent reads it.

WHAT IS WANTED: a non-blocking finding that says the name could not be verified. Dispatching a partial by variable is a legitimate, widely-used pattern — this must NOT become an error, and must NOT join `BLOCKING_CHECKS`. The value is turning a false all-clear into an explicit "not checked".

OUT OF SCOPE: resolving the name. It is undecidable in general, and no attempt at constant-folding or flow analysis belongs here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A render/include/function tag whose partial name is not a string literal produces a finding at severity INFO, naming the tag and the variable used
- [ ] #2 The finding does not block: the check is absent from BLOCKING_CHECKS and `must_fix_before_write` stays false for a buffer whose only finding is this one
- [ ] #3 A literal-named partial that resolves produces NO finding, and a literal-named partial that does not resolve still produces MissingPartial and nothing from this check — both asserted as controls beside the silence cases
- [ ] #4 Deliberately breaking the new detector makes its tests fail, and deliberately widening it to fire on every render makes the control tests fail
- [ ] #5 The check is registered in src/checks/index.ts and the factory configs are regenerated so all.yml and recommended.yml list it
- [ ] #6 transport/instructions.ts states that impact.dependents counts statically-resolvable references only, so total: 0 is not a claim that a dynamically-rendered partial is unused
- [ ] #7 ValidateCodeImpact's dependents docblock in result/types.ts carries the same limitation
- [ ] #8 A changeset accompanies the change
- [ ] #9 A documentation page for the new check code exists upstream in platformos-documentation, or its absence is recorded on this task with the reason
<!-- AC:END -->
